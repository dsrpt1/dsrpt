// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

/**
 * @title HazardCurveEngine
 * @notice Calculates risk-based premiums using actuarial hazard curve model
 * @dev Premium = max(expectedLoss, minPremium) where:
 *      - Hazard rate h(t) = baseProbPerDay + slopePerDay × t
 *      - Expected loss = coverage × cumulative hazard over tenor
 *      - minPremium = coverage × minPremiumBps / 10000
 */
contract HazardCurveEngine {
    /// @notice Curve parameters for premium calculation
    struct Curve {
        uint256 baseProbPerDay;   // Base daily probability (scaled by 1e18)
        uint256 slopePerDay;      // Daily increase in probability (scaled by 1e18)
        uint256 minPremiumBps;    // Minimum premium in basis points (e.g., 500 = 5%)
    }

    /// @notice Oracle configuration for dynamic risk adjustment
    struct OracleConfig {
        AggregatorV3Interface priceFeed;  // Chainlink price feed
        uint256 pegPrice;                  // Expected peg price (scaled by feed decimals)
        uint256 deviationThresholdBps;     // Deviation threshold for risk multiplier (bps)
        uint256 maxRiskMultiplier;         // Maximum risk multiplier (scaled by 1e18, e.g., 3e18 = 3x)
    }

    /// @dev Precision for probability calculations
    uint256 private constant PRECISION = 1e18;
    uint256 private constant BPS_PRECISION = 10_000;

    /// @notice Mapping of curve ID to curve parameters
    mapping(bytes32 => Curve) public curves;

    /// @notice Mapping of curve ID to oracle configuration (optional)
    mapping(bytes32 => OracleConfig) public oracles;

    /// @notice Contract owner for admin functions
    address public owner;

    event CurveSet(bytes32 indexed id, uint256 baseProbPerDay, uint256 slopePerDay, uint256 minPremiumBps);
    event OracleSet(bytes32 indexed id, address priceFeed, uint256 pegPrice, uint256 deviationThresholdBps);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "HazardCurveEngine: not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Set curve parameters for a given curve ID
     * @param id Curve identifier (e.g., keccak256("USDC_DEPEG"))
     * @param c Curve parameters
     */
    function setCurve(bytes32 id, Curve memory c) external onlyOwner {
        curves[id] = c;
        emit CurveSet(id, c.baseProbPerDay, c.slopePerDay, c.minPremiumBps);
    }

    /**
     * @notice Set oracle configuration for dynamic risk adjustment
     * @param id Curve identifier
     * @param priceFeed Chainlink price feed address
     * @param pegPrice Expected peg price (in feed decimals)
     * @param deviationThresholdBps Deviation threshold in basis points
     * @param maxRiskMultiplier Maximum risk multiplier (1e18 = 1x)
     */
    function setOracle(
        bytes32 id,
        address priceFeed,
        uint256 pegPrice,
        uint256 deviationThresholdBps,
        uint256 maxRiskMultiplier
    ) external onlyOwner {
        oracles[id] = OracleConfig({
            priceFeed: AggregatorV3Interface(priceFeed),
            pegPrice: pegPrice,
            deviationThresholdBps: deviationThresholdBps,
            maxRiskMultiplier: maxRiskMultiplier
        });
        emit OracleSet(id, priceFeed, pegPrice, deviationThresholdBps);
    }

    /**
     * @notice Calculate premium for given coverage and tenor
     * @param id Curve identifier
     * @param coverage Coverage amount in asset decimals
     * @param tenorDays Duration of coverage in days
     * @return premium Premium amount in asset decimals
     */
    function premiumOf(bytes32 id, uint256 coverage, uint256 tenorDays) external view returns (uint256) {
        Curve memory c = curves[id];

        // If curve not initialized, return 0
        if (c.baseProbPerDay == 0 && c.slopePerDay == 0 && c.minPremiumBps == 0) {
            return 0;
        }

        // Calculate cumulative hazard over the tenor
        // H(T) = ∫₀ᵀ h(t)dt = baseProbPerDay × T + slopePerDay × T² / 2
        uint256 linearComponent = c.baseProbPerDay * tenorDays;
        uint256 quadraticComponent = (c.slopePerDay * tenorDays * tenorDays) / 2;
        uint256 cumulativeHazard = linearComponent + quadraticComponent;

        // Expected loss = coverage × (1 - e^(-H)) ≈ coverage × H for small H
        // Using linear approximation for gas efficiency
        uint256 expectedLoss = (coverage * cumulativeHazard) / PRECISION;

        // Apply risk multiplier from oracle if configured
        uint256 riskMultiplier = getRiskMultiplier(id);
        if (riskMultiplier > PRECISION) {
            expectedLoss = (expectedLoss * riskMultiplier) / PRECISION;
        }

        // Calculate minimum premium
        uint256 minPremium = (coverage * c.minPremiumBps) / BPS_PRECISION;

        // Return the greater of expected loss or minimum premium
        return expectedLoss > minPremium ? expectedLoss : minPremium;
    }

    /**
     * @notice Get risk multiplier based on current oracle price deviation
     * @param id Curve identifier
     * @return multiplier Risk multiplier (1e18 = 1x, 2e18 = 2x, etc.)
     */
    function getRiskMultiplier(bytes32 id) public view returns (uint256) {
        OracleConfig memory config = oracles[id];

        // If no oracle configured, return 1x multiplier
        if (address(config.priceFeed) == address(0)) {
            return PRECISION;
        }

        try config.priceFeed.latestRoundData() returns (
            uint80,
            int256 price,
            uint256,
            uint256 updatedAt,
            uint80
        ) {
            // Check for stale data (older than 1 hour)
            if (block.timestamp - updatedAt > 3600) {
                return PRECISION; // Return 1x if stale
            }

            if (price <= 0) {
                return config.maxRiskMultiplier; // Max risk if invalid price
            }

            uint256 currentPrice = uint256(price);

            // Calculate deviation from peg
            uint256 deviation;
            if (currentPrice >= config.pegPrice) {
                deviation = ((currentPrice - config.pegPrice) * BPS_PRECISION) / config.pegPrice;
            } else {
                deviation = ((config.pegPrice - currentPrice) * BPS_PRECISION) / config.pegPrice;
            }

            // If within threshold, no adjustment
            if (deviation <= config.deviationThresholdBps) {
                return PRECISION;
            }

            // Linear interpolation: multiplier increases as deviation increases
            // multiplier = 1 + (deviation - threshold) / threshold × (maxMultiplier - 1)
            uint256 excessDeviation = deviation - config.deviationThresholdBps;
            uint256 multiplierIncrease = (excessDeviation * (config.maxRiskMultiplier - PRECISION)) / config.deviationThresholdBps;
            uint256 multiplier = PRECISION + multiplierIncrease;

            // Cap at max multiplier
            return multiplier > config.maxRiskMultiplier ? config.maxRiskMultiplier : multiplier;
        } catch {
            return PRECISION; // Return 1x on oracle error
        }
    }

    /**
     * @notice Get current curve parameters
     * @param id Curve identifier
     * @return baseProbPerDay Base probability per day
     * @return slopePerDay Slope per day
     * @return minPremiumBps Minimum premium in basis points
     */
    function getCurve(bytes32 id) external view returns (
        uint256 baseProbPerDay,
        uint256 slopePerDay,
        uint256 minPremiumBps
    ) {
        Curve memory c = curves[id];
        return (c.baseProbPerDay, c.slopePerDay, c.minPremiumBps);
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
