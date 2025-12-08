// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

/**
 * @title HazardCurveEngine
 * @notice Calculates risk-based premiums using actuarial hazard curve model
 * @dev Premium = max(expectedLoss × riskMultiplier, minPremium) where:
 *      - Hazard rate h(t) = baseProbPerDay + slopePerDay × t
 *      - Cumulative hazard H(T) = baseProbPerDay × T + slopePerDay × T² / 2
 *      - Expected loss = coverage × H(T) / 1e18
 *      - Risk multiplier from oracle price deviation (1x to maxMultiplier)
 */
contract HazardCurveEngine {
    /// @notice Curve parameters for premium calculation
    struct Curve {
        uint256 baseProbPerDay;     // Base daily probability (scaled by 1e18)
        uint256 slopePerDay;        // Daily increase in probability (scaled by 1e18)
        uint16 minPremiumBps;       // Minimum premium in basis points (e.g., 50 = 0.50%)
        uint16 maxMultiplierBps;    // Maximum risk multiplier in bps (e.g., 30000 = 3.0x)
        uint16 pegThresholdBps;     // Deviation threshold before scaling (e.g., 50 = 0.50%)
        uint32 oracleStaleAfter;    // Seconds after which oracle data is stale
        bool active;                // Whether this curve is active
    }

    /// @dev Precision constants
    uint256 private constant PRECISION = 1e18;
    uint256 private constant BPS_PRECISION = 10_000;
    uint256 private constant PRICE_PRECISION = 1e8;

    /// @notice Mapping of peril ID to curve parameters
    mapping(bytes32 => Curve) public curves;

    /// @notice Chainlink price feed for the underlying asset
    AggregatorV3Interface public priceFeed;

    /// @notice Contract owner for admin functions
    address public owner;

    event CurveSet(bytes32 indexed perilId, Curve curve);
    event PriceFeedSet(address indexed feed);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "HazardCurveEngine: not owner");
        _;
    }

    constructor(address _priceFeed) {
        owner = msg.sender;
        if (_priceFeed != address(0)) {
            priceFeed = AggregatorV3Interface(_priceFeed);
        }
    }

    /**
     * @notice Set the Chainlink price feed
     * @param _priceFeed Address of the Chainlink aggregator
     */
    function setPriceFeed(address _priceFeed) external onlyOwner {
        require(_priceFeed != address(0), "HazardCurveEngine: zero address");
        priceFeed = AggregatorV3Interface(_priceFeed);
        emit PriceFeedSet(_priceFeed);
    }

    /**
     * @notice Set curve parameters for a given peril ID
     * @param perilId Peril identifier (e.g., keccak256("stablecoin_depeg:USDC"))
     * @param baseProbPerDay Base probability per day (1e18 scale)
     * @param slopePerDay Slope increase per day (1e18 scale)
     * @param minPremiumBps Minimum premium in basis points
     * @param maxMultiplierBps Maximum risk multiplier in basis points (10000 = 1x)
     * @param pegThresholdBps Deviation threshold before multiplier scaling
     * @param oracleStaleAfter Seconds after which oracle data is considered stale
     * @param active Whether the curve is active
     */
    function setCurve(
        bytes32 perilId,
        uint256 baseProbPerDay,
        uint256 slopePerDay,
        uint16 minPremiumBps,
        uint16 maxMultiplierBps,
        uint16 pegThresholdBps,
        uint32 oracleStaleAfter,
        bool active
    ) external onlyOwner {
        require(maxMultiplierBps >= 10000, "HazardCurveEngine: maxMult < 1x");

        curves[perilId] = Curve({
            baseProbPerDay: baseProbPerDay,
            slopePerDay: slopePerDay,
            minPremiumBps: minPremiumBps,
            maxMultiplierBps: maxMultiplierBps,
            pegThresholdBps: pegThresholdBps,
            oracleStaleAfter: oracleStaleAfter,
            active: active
        });

        emit CurveSet(perilId, curves[perilId]);
    }

    /**
     * @notice Compute cumulative hazard H(T) = b×T + s×T²/2
     * @param baseProbPerDay Base probability per day (1e18 scale)
     * @param slopePerDay Slope per day (1e18 scale)
     * @param tenorDays Duration in days
     * @return H Cumulative hazard (1e18 scale)
     */
    function cumulativeHazard(
        uint256 baseProbPerDay,
        uint256 slopePerDay,
        uint256 tenorDays
    ) public pure returns (uint256 H) {
        // H(T) = b×T + (s×T²)/2
        uint256 linearComponent = baseProbPerDay * tenorDays;
        uint256 quadraticComponent = (slopePerDay * tenorDays * tenorDays) / 2;
        H = linearComponent + quadraticComponent;
    }

    /**
     * @notice Calculate premium for given coverage and tenor
     * @param perilId Peril identifier
     * @param coverage Coverage amount in asset decimals
     * @param tenorDays Duration of coverage in days
     * @return premium Premium amount in asset decimals
     * @return expectedLoss Expected loss before multiplier
     * @return multiplierBps Risk multiplier used (10000 = 1x)
     */
    function quotePremium(
        bytes32 perilId,
        uint256 coverage,
        uint256 tenorDays
    ) external view returns (uint256 premium, uint256 expectedLoss, uint256 multiplierBps) {
        Curve memory c = curves[perilId];
        require(c.active, "HazardCurveEngine: curve inactive");
        require(tenorDays > 0, "HazardCurveEngine: tenor = 0");
        require(coverage > 0, "HazardCurveEngine: coverage = 0");

        // 1) Calculate cumulative hazard H(T)
        uint256 H = cumulativeHazard(c.baseProbPerDay, c.slopePerDay, tenorDays);

        // 2) Expected loss = coverage × H / 1e18
        expectedLoss = (coverage * H) / PRECISION;

        // 3) Get risk multiplier from oracle
        multiplierBps = _riskMultiplierBps(c);

        // 4) Raw premium = expectedLoss × multiplier / 10000
        uint256 rawPremium = (expectedLoss * multiplierBps) / BPS_PRECISION;

        // 5) Floor premium = coverage × minPremiumBps / 10000
        uint256 floorPremium = (coverage * c.minPremiumBps) / BPS_PRECISION;

        // 6) Return max(rawPremium, floorPremium)
        premium = rawPremium >= floorPremium ? rawPremium : floorPremium;
    }

    /**
     * @notice Legacy function for backwards compatibility
     * @dev Wraps quotePremium and returns only the premium
     */
    function premiumOf(bytes32 perilId, uint256 coverage, uint256 tenorDays) external view returns (uint256) {
        Curve memory c = curves[perilId];

        // If curve not initialized or inactive, return 0
        if (!c.active) {
            return 0;
        }
        if (tenorDays == 0 || coverage == 0) {
            return 0;
        }

        // Calculate cumulative hazard
        uint256 H = cumulativeHazard(c.baseProbPerDay, c.slopePerDay, tenorDays);

        // Expected loss
        uint256 expectedLoss = (coverage * H) / PRECISION;

        // Risk multiplier
        uint256 multiplierBps = _riskMultiplierBps(c);

        // Raw premium with multiplier
        uint256 rawPremium = (expectedLoss * multiplierBps) / BPS_PRECISION;

        // Floor premium
        uint256 floorPremium = (coverage * c.minPremiumBps) / BPS_PRECISION;

        return rawPremium >= floorPremium ? rawPremium : floorPremium;
    }

    /**
     * @notice Calculate risk multiplier based on oracle price deviation
     * @param c Curve parameters
     * @return multiplierBps Risk multiplier in basis points (10000 = 1x)
     */
    function _riskMultiplierBps(Curve memory c) internal view returns (uint256) {
        uint256 oneX = BPS_PRECISION; // 10000 = 1.0x

        // If no price feed configured, return 1x
        if (address(priceFeed) == address(0)) {
            return oneX;
        }

        try priceFeed.latestRoundData() returns (
            uint80,
            int256 answer,
            uint256,
            uint256 updatedAt,
            uint80
        ) {
            // Check for stale data
            if (block.timestamp > updatedAt + c.oracleStaleAfter) {
                return oneX;
            }

            // Require positive price
            if (answer <= 0) {
                return oneX;
            }

            // Normalize price to 1e8 decimals
            uint256 price1e8 = uint256(answer);
            uint8 decimals = priceFeed.decimals();
            if (decimals > 8) {
                price1e8 = price1e8 / (10 ** (decimals - 8));
            } else if (decimals < 8) {
                price1e8 = price1e8 * (10 ** (8 - decimals));
            }

            // Target peg = $1.00 = 1e8
            uint256 peg = PRICE_PRECISION;

            // Calculate absolute deviation in bps
            uint256 deviation = price1e8 > peg
                ? price1e8 - peg
                : peg - price1e8;
            uint256 deviationBps = (deviation * BPS_PRECISION) / peg;

            // If within threshold, return 1x
            if (deviationBps <= c.pegThresholdBps) {
                return oneX;
            }

            // Linear ramp from threshold to 10× threshold
            uint256 excess = deviationBps - c.pegThresholdBps;
            uint256 span = 10 * c.pegThresholdBps;

            // If excess >= span, return max multiplier
            if (excess >= span) {
                return c.maxMultiplierBps;
            }

            // Linear interpolation: m = 1x + (excess/span) × (maxMult - 1x)
            uint256 fraction = (excess * BPS_PRECISION) / (span == 0 ? 1 : span);
            uint256 delta = ((c.maxMultiplierBps - oneX) * fraction) / BPS_PRECISION;

            return oneX + delta;
        } catch {
            // Return 1x on any oracle error
            return oneX;
        }
    }

    /**
     * @notice Get current risk multiplier for a peril
     * @param perilId Peril identifier
     * @return multiplierBps Current risk multiplier (10000 = 1x)
     */
    function getRiskMultiplier(bytes32 perilId) external view returns (uint256) {
        Curve memory c = curves[perilId];
        return _riskMultiplierBps(c);
    }

    /**
     * @notice Get curve parameters
     * @param perilId Peril identifier
     */
    function getCurve(bytes32 perilId) external view returns (
        uint256 baseProbPerDay,
        uint256 slopePerDay,
        uint16 minPremiumBps,
        uint16 maxMultiplierBps,
        uint16 pegThresholdBps,
        uint32 oracleStaleAfter,
        bool active
    ) {
        Curve memory c = curves[perilId];
        return (
            c.baseProbPerDay,
            c.slopePerDay,
            c.minPremiumBps,
            c.maxMultiplierBps,
            c.pegThresholdBps,
            c.oracleStaleAfter,
            c.active
        );
    }

    /**
     * @notice Transfer ownership to a new address
     * @param newOwner New owner address
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "HazardCurveEngine: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
