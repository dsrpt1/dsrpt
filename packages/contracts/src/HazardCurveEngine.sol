// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

/**
 * @title HazardCurveEngine
 * @notice Simplified on-chain risk pricing for parametric insurance
 * @dev This is a basic implementation. Full actuarial pricing (GPD + Hawkes)
 *      is done off-chain via the /api/quote endpoint. This contract serves
 *      as a sanity check and fallback.
 */
contract HazardCurveEngine is Ownable {
    struct Curve {
        uint256 baseProbPerDay;   // Base probability per day (unused in current impl)
        uint256 slopePerDay;      // Slope per day (unused in current impl)
        uint256 minPremiumBps;    // Minimum premium in basis points (0.5% = 50 bps)
    }

    mapping(bytes32 => Curve) public curves;

    event CurveUpdated(bytes32 indexed id, uint256 baseProbPerDay, uint256 slopePerDay, uint256 minPremiumBps);

    error CurveNotFound(bytes32 id);
    error InvalidCurveParams();

    constructor(address _initialOwner) Ownable(_initialOwner) {}

    /// @notice Set or update a risk curve (only owner)
    /// @param id Curve identifier (e.g., keccak256("usdc-depeg"))
    /// @param c Curve parameters
    function setCurve(bytes32 id, Curve memory c) external onlyOwner {
        if (c.minPremiumBps == 0 || c.minPremiumBps > 10_000) {
            revert InvalidCurveParams();
        }

        curves[id] = c;
        emit CurveUpdated(id, c.baseProbPerDay, c.slopePerDay, c.minPremiumBps);
    }

    /// @notice Calculate premium for given coverage and duration
    /// @param id Curve identifier
    /// @param coverage Coverage amount (payout)
    /// @param tenorDays Policy duration in days
    /// @return Premium amount in asset units
    /// @dev Current implementation: premium = (coverage × minPremiumBps) / 10,000
    ///      Future: Could incorporate baseProbPerDay and slopePerDay for time-dependent pricing
    function premiumOf(
        bytes32 id,
        uint256 coverage,
        uint256 tenorDays
    ) external view returns (uint256) {
        Curve memory c = curves[id];

        // Check curve exists
        if (c.minPremiumBps == 0) {
            revert CurveNotFound(id);
        }

        // Simple formula: premium = coverage × minPremiumBps / 10,000
        // Note: tenorDays is currently unused (time-invariant pricing)
        // Full actuarial model is implemented off-chain in /api/quote
        uint256 bps = c.minPremiumBps;
        return (coverage * bps) / 10_000;

        // Future enhancement: Time-dependent pricing
        // uint256 timeAdjustment = baseProbPerDay + (slopePerDay * tenorDays);
        // return (coverage * (bps + timeAdjustment)) / 10_000;
    }

    /// @notice Get curve parameters
    /// @param id Curve identifier
    /// @return Curve parameters
    function getCurve(bytes32 id) external view returns (Curve memory) {
        return curves[id];
    }

    /// @notice Check if curve exists
    /// @param id Curve identifier
    /// @return True if curve is configured
    function curveExists(bytes32 id) external view returns (bool) {
        return curves[id].minPremiumBps > 0;
    }
}
