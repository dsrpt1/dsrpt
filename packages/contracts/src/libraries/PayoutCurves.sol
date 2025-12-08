// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IDsrptHazardEngine} from "../interfaces/IDsrptHazardEngine.sol";

/**
 * @title PayoutCurves
 * @notice Library for parametric payout curve calculations
 * @dev Implements severity and duration-based payout functions
 */
library PayoutCurves {
    /// @dev Precision for calculations
    uint256 internal constant PRECISION = 1e18;
    /// @dev Basis points precision
    uint256 internal constant BPS = 10_000;

    /**
     * @notice Calculate payout for a triggered policy
     * @dev Payout = policyLimit × f(d) × g(t)
     *      where f(d) = severity factor, g(t) = duration factor
     * @param curve PayoutCurve configuration
     * @param policyLimit Coverage limit in USD
     * @param depegBps Deviation from peg in basis points
     * @param durationHours Duration trigger was active in hours
     * @return payout Final payout amount
     * @return severityFactor f(d) component scaled by 1e18
     * @return durationFactor g(t) component scaled by 1e18
     */
    function calculatePayout(
        IDsrptHazardEngine.PayoutCurve memory curve,
        uint256 policyLimit,
        uint256 depegBps,
        uint256 durationHours
    ) internal pure returns (
        uint256 payout,
        uint256 severityFactor,
        uint256 durationFactor
    ) {
        // Calculate severity factor f(d)
        severityFactor = _severityFactor(depegBps, curve.maxDeviationBps, curve.severityExponent);

        // Calculate duration factor g(t)
        durationFactor = _durationFactor(durationHours, curve.thresholdHours);

        // Final payout = limit × f(d) × g(t)
        payout = (policyLimit * severityFactor * durationFactor) / (PRECISION * PRECISION);
    }

    /**
     * @notice Calculate severity factor f(d)
     * @dev rawFactor = min(depegBps / maxDeviationBps, 1.0)
     *      f(d) = rawFactor ^ severityExponent
     *      Exponent 1 = linear (proportional to deviation)
     *      Exponent 2 = convex (small deviations pay less)
     *      Exponent 3 = highly convex (only large deviations pay significantly)
     * @param depegBps Deviation in basis points
     * @param maxDeviationBps Maximum claimable deviation
     * @param exponent Severity curve exponent
     * @return factor Severity factor scaled by 1e18
     */
    function _severityFactor(
        uint256 depegBps,
        uint32 maxDeviationBps,
        uint8 exponent
    ) internal pure returns (uint256 factor) {
        if (maxDeviationBps == 0) return 0;
        if (depegBps == 0) return 0;

        // Calculate raw factor (capped at 1.0)
        uint256 rawFactor;
        if (depegBps >= maxDeviationBps) {
            rawFactor = PRECISION;
        } else {
            rawFactor = (depegBps * PRECISION) / maxDeviationBps;
        }

        // Apply exponent
        if (exponent <= 1) {
            // Linear
            factor = rawFactor;
        } else if (exponent == 2) {
            // Quadratic (convex)
            factor = (rawFactor * rawFactor) / PRECISION;
        } else {
            // Cubic or higher (highly convex)
            factor = (rawFactor * rawFactor * rawFactor) / (PRECISION * PRECISION);
        }
    }

    /**
     * @notice Calculate duration factor g(t)
     * @dev g(t) = min(durationHours / thresholdHours, 1.0)
     *      Linear ramp from 0 to 1 over threshold period
     *      Incentivizes long-duration triggers for full payout
     * @param durationHours Duration trigger was active
     * @param thresholdHours Duration for full factor
     * @return factor Duration factor scaled by 1e18
     */
    function _durationFactor(
        uint256 durationHours,
        uint32 thresholdHours
    ) internal pure returns (uint256 factor) {
        if (thresholdHours == 0) return PRECISION;
        if (durationHours == 0) return 0;

        if (durationHours >= thresholdHours) {
            return PRECISION;
        }

        return (durationHours * PRECISION) / thresholdHours;
    }

    /**
     * @notice Validate payout curve parameters
     * @param curve PayoutCurve to validate
     * @return valid True if parameters are within acceptable bounds
     */
    function validateCurve(
        IDsrptHazardEngine.PayoutCurve memory curve
    ) internal pure returns (bool valid) {
        // maxDeviationBps should be reasonable (1% - 50%)
        if (curve.maxDeviationBps < 100 || curve.maxDeviationBps > 5000) {
            return false;
        }

        // thresholdHours should be reasonable (1 hour - 30 days)
        if (curve.thresholdHours < 1 || curve.thresholdHours > 720) {
            return false;
        }

        // severityExponent should be 1, 2, or 3
        if (curve.severityExponent < 1 || curve.severityExponent > 3) {
            return false;
        }

        return true;
    }

    /**
     * @notice Calculate expected payout given trigger distribution
     * @dev Used for hazard curve validation
     *      E[payout] = limit × E[f(d)] × E[g(t)]
     * @param curve PayoutCurve configuration
     * @param policyLimit Coverage limit
     * @param expectedDepegBps Expected deviation (mean)
     * @param expectedDurationHours Expected duration (mean)
     * @return expectedPayout Expected payout amount
     */
    function expectedPayoutGivenTrigger(
        IDsrptHazardEngine.PayoutCurve memory curve,
        uint256 policyLimit,
        uint256 expectedDepegBps,
        uint256 expectedDurationHours
    ) internal pure returns (uint256 expectedPayout) {
        (uint256 payout, , ) = calculatePayout(
            curve,
            policyLimit,
            expectedDepegBps,
            expectedDurationHours
        );
        return payout;
    }

    /**
     * @notice Calculate payout at maximum severity and duration
     * @dev Used to understand worst-case exposure
     * @param curve PayoutCurve configuration
     * @param policyLimit Coverage limit
     * @return maxPayout Maximum possible payout (equals policyLimit)
     */
    function maxPayout(
        IDsrptHazardEngine.PayoutCurve memory curve,
        uint256 policyLimit
    ) internal pure returns (uint256) {
        // At max deviation and max duration, payout = policyLimit
        // f(maxDev) = 1.0, g(threshold) = 1.0
        // This validates our curve design
        (uint256 payout, , ) = calculatePayout(
            curve,
            policyLimit,
            curve.maxDeviationBps,
            curve.thresholdHours
        );
        return payout;
    }
}
