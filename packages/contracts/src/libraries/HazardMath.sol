// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IDsrptHazardEngine} from "../interfaces/IDsrptHazardEngine.sol";

/**
 * @title HazardMath
 * @notice Gas-optimized math library for hazard curve operations
 * @dev Pure/view functions for interpolation and multiplier calculations
 */
library HazardMath {
    /// @dev Precision for probability and factor calculations
    uint256 internal constant PRECISION = 1e18;
    /// @dev Basis points precision
    uint256 internal constant BPS = 10_000;
    /// @dev Maximum multiplier cap (2.0x for book multiplier)
    uint256 internal constant MAX_BOOK_MULTIPLIER_BPS = 20_000;
    /// @dev One hour in seconds (for staleness checks)
    uint256 internal constant HOUR = 3600;

    // ============ HAZARD INTERPOLATION ============

    /**
     * @notice Interpolate cumulative hazard at arbitrary tenor
     * @dev Piecewise linear interpolation between fixed calibration points
     *      - If tenorDays <= 7: linear from origin to H(7)
     *      - If 7 < tenorDays <= 30: linear between H(7) and H(30)
     *      - If 30 < tenorDays <= 90: linear between H(30) and H(90)
     *      - If tenorDays > 90: H(90) + tailSlope * (tenorDays - 90)
     * @param terms Array of 3 HazardTerm structs [7d, 30d, 90d]
     * @param tailSlope1e18 Hazard rate for T > 90, scaled by 1e18
     * @param tenorDays Target tenor in days
     * @return H1e18 Cumulative hazard scaled by 1e18
     */
    function interpolateH(
        IDsrptHazardEngine.HazardTerm[3] memory terms,
        uint224 tailSlope1e18,
        uint256 tenorDays
    ) internal pure returns (uint256 H1e18) {
        // Validate terms are ordered correctly
        // terms[0] = 7d, terms[1] = 30d, terms[2] = 90d

        if (tenorDays == 0) {
            return 0;
        }

        uint256 t0 = terms[0].tenorDays; // 7
        uint256 t1 = terms[1].tenorDays; // 30
        uint256 t2 = terms[2].tenorDays; // 90

        uint256 h0 = terms[0].H1e18;
        uint256 h1 = terms[1].H1e18;
        uint256 h2 = terms[2].H1e18;

        if (tenorDays <= t0) {
            // Linear from origin to first point
            // H(t) = H(7) * t / 7
            return (h0 * tenorDays) / t0;
        } else if (tenorDays <= t1) {
            // Linear between H(7) and H(30)
            // H(t) = H(7) + (H(30) - H(7)) * (t - 7) / (30 - 7)
            return h0 + ((h1 - h0) * (tenorDays - t0)) / (t1 - t0);
        } else if (tenorDays <= t2) {
            // Linear between H(30) and H(90)
            // H(t) = H(30) + (H(90) - H(30)) * (t - 30) / (90 - 30)
            return h1 + ((h2 - h1) * (tenorDays - t1)) / (t2 - t1);
        } else {
            // Tail extrapolation: H(90) + tailSlope * (t - 90)
            return h2 + (uint256(tailSlope1e18) * (tenorDays - t2));
        }
    }

    // ============ MARKET MULTIPLIER ============

    /**
     * @notice Calculate market risk multiplier from oracle state
     * @dev Composite risk score based on:
     *      - pegDevBps: Direct deviation from peg
     *      - volBps / 2: Volatility contribution
     *      - disagreementBps / 2: Cross-venue spread
     *      - shockAdjustment: 0/500/1500 based on shockFlag
     *      Multiplier = 1.0x + scale(composite - baseline, 0 -> max)
     * @param state Current OracleState
     * @param maxMultiplierBps Ceiling on multiplier (e.g., 30000 = 3.0x)
     * @param currentTimestamp Current block.timestamp
     * @return multiplierBps Multiplier in basis points (10000 = 1.0x)
     */
    function calculateMarketMultiplier(
        IDsrptHazardEngine.OracleState memory state,
        uint32 maxMultiplierBps,
        uint256 currentTimestamp
    ) internal pure returns (uint256 multiplierBps) {
        // If oracle data is stale (> 1 hour), return max multiplier (conservative)
        if (currentTimestamp > uint256(state.updatedAt) + HOUR) {
            return maxMultiplierBps;
        }

        // Calculate composite risk score
        uint256 shockAdjustment;
        if (state.shockFlag == 2) {
            shockAdjustment = 1500; // Shock
        } else if (state.shockFlag == 1) {
            shockAdjustment = 500;  // Warning
        }
        // else 0 for normal

        uint256 compositeScore = uint256(state.pegDevBps) +
            (uint256(state.volBps) / 2) +
            (uint256(state.disagreementBps) / 2) +
            shockAdjustment;

        // Baseline: 50 bps (0.5% peg dev considered "normal")
        uint256 baseline = 50;

        if (compositeScore <= baseline) {
            return BPS; // 1.0x multiplier
        }

        // Scale: For every 100 bps above baseline, add 0.1x multiplier
        // Max additional multiplier = maxMultiplierBps - 10000
        uint256 excess = compositeScore - baseline;
        uint256 additionalBps = (excess * BPS) / 1000; // 100 bps -> 1000 bps (0.1x)

        multiplierBps = BPS + additionalBps;

        // Cap at max
        if (multiplierBps > maxMultiplierBps) {
            multiplierBps = maxMultiplierBps;
        }
    }

    // ============ BOOK MULTIPLIER ============

    /**
     * @notice Calculate book risk multiplier from portfolio/tranche state
     * @dev Additive penalties for:
     *      - Utilization > 70%: +5% per 10% increment (capped at +30%)
     *      - Capital ratio < 100%: penalty proportional to deficit (capped at +30%)
     *      - Concentration > 30%: mild slope (capped at +20%)
     *      - Junior util > 90%: +20%
     *      - Mezz util > 70%: +10%
     *      - Senior util > 50%: +50% (near circuit breaker)
     * @param portfolioState Current PortfolioState
     * @param trancheState Current TrancheState
     * @return multiplierBps Multiplier in basis points (10000 = 1.0x, max 20000 = 2.0x)
     */
    function calculateBookMultiplier(
        IDsrptHazardEngine.PortfolioState memory portfolioState,
        IDsrptHazardEngine.TrancheState memory trancheState
    ) internal pure returns (uint256 multiplierBps) {
        multiplierBps = BPS; // Start at 1.0x

        // Utilization penalty: +5% per 10% above 70%
        if (portfolioState.utilizationBps > 7000) {
            uint256 excessUtil = portfolioState.utilizationBps - 7000;
            // +500 bps per 1000 bps of excess, capped at 3000 bps (+30%)
            uint256 utilPenalty = (excessUtil * 500) / 1000;
            if (utilPenalty > 3000) utilPenalty = 3000;
            multiplierBps += utilPenalty;
        }

        // Capital ratio penalty: penalty if ratio < 100%
        if (portfolioState.capitalRatioBps < BPS) {
            // Deficit = 10000 - capitalRatioBps
            uint256 deficit = BPS - portfolioState.capitalRatioBps;
            // +3% per 10% deficit, capped at 30%
            uint256 capitalPenalty = (deficit * 300) / 1000;
            if (capitalPenalty > 3000) capitalPenalty = 3000;
            multiplierBps += capitalPenalty;
        }

        // Concentration penalty: mild slope above 30%
        if (portfolioState.perilConcentrationBps > 3000) {
            uint256 excessConc = portfolioState.perilConcentrationBps - 3000;
            // +2% per 10% excess, capped at 20%
            uint256 concPenalty = (excessConc * 200) / 1000;
            if (concPenalty > 2000) concPenalty = 2000;
            multiplierBps += concPenalty;
        }

        // Tranche stress penalties
        if (trancheState.juniorUtilBps > 9000) {
            multiplierBps += 2000; // +20%
        }
        if (trancheState.mezzUtilBps > 7000) {
            multiplierBps += 1000; // +10%
        }
        if (trancheState.seniorUtilBps > 5000) {
            multiplierBps += 5000; // +50% (near circuit breaker)
        }

        // Cap at 2.0x
        if (multiplierBps > MAX_BOOK_MULTIPLIER_BPS) {
            multiplierBps = MAX_BOOK_MULTIPLIER_BPS;
        }
    }

    // ============ PAYOUT CALCULATIONS ============

    /**
     * @notice Calculate severity factor f(d)
     * @dev rawFactor = min(depegBps / maxDeviationBps, 1.0)
     *      Apply exponent: f(d) = rawFactor^exponent
     * @param depegBps Deviation in basis points
     * @param maxDeviationBps Maximum claimable deviation
     * @param exponent Severity exponent (1/2/3)
     * @return factor1e18 Severity factor scaled by 1e18
     */
    function calculateSeverityFactor(
        uint256 depegBps,
        uint32 maxDeviationBps,
        uint8 exponent
    ) internal pure returns (uint256 factor1e18) {
        if (maxDeviationBps == 0) return 0;

        // rawFactor = min(depegBps / maxDeviationBps, 1.0)
        uint256 rawFactor1e18;
        if (depegBps >= maxDeviationBps) {
            rawFactor1e18 = PRECISION;
        } else {
            rawFactor1e18 = (depegBps * PRECISION) / maxDeviationBps;
        }

        // Apply exponent
        if (exponent == 1) {
            factor1e18 = rawFactor1e18;
        } else if (exponent == 2) {
            factor1e18 = (rawFactor1e18 * rawFactor1e18) / PRECISION;
        } else if (exponent == 3) {
            factor1e18 = (rawFactor1e18 * rawFactor1e18 * rawFactor1e18) / (PRECISION * PRECISION);
        } else {
            // Default to linear for invalid exponent
            factor1e18 = rawFactor1e18;
        }
    }

    /**
     * @notice Calculate duration factor g(t)
     * @dev g(t) = min(durationHours / thresholdHours, 1.0)
     * @param durationHours Trigger duration in hours
     * @param thresholdHours Full duration threshold
     * @return factor1e18 Duration factor scaled by 1e18
     */
    function calculateDurationFactor(
        uint256 durationHours,
        uint32 thresholdHours
    ) internal pure returns (uint256 factor1e18) {
        if (thresholdHours == 0) return PRECISION;

        if (durationHours >= thresholdHours) {
            return PRECISION;
        }

        return (durationHours * PRECISION) / thresholdHours;
    }

    /**
     * @notice Calculate final payout amount
     * @dev payout = policyLimit × f(d) × g(t)
     * @param policyLimit Coverage limit in USD
     * @param severityFactor1e18 Severity factor from calculateSeverityFactor
     * @param durationFactor1e18 Duration factor from calculateDurationFactor
     * @return payout Final payout amount
     */
    function calculatePayout(
        uint256 policyLimit,
        uint256 severityFactor1e18,
        uint256 durationFactor1e18
    ) internal pure returns (uint256 payout) {
        return (policyLimit * severityFactor1e18 * durationFactor1e18) / (PRECISION * PRECISION);
    }

    // ============ PREMIUM CALCULATION ============

    /**
     * @notice Calculate expected loss
     * @dev EL = coverage × H(T) / 1e18
     * @param coverage Coverage amount in USD
     * @param H1e18 Cumulative hazard scaled by 1e18
     * @return expectedLoss Expected loss amount
     */
    function calculateExpectedLoss(
        uint256 coverage,
        uint256 H1e18
    ) internal pure returns (uint256 expectedLoss) {
        return (coverage * H1e18) / PRECISION;
    }

    /**
     * @notice Calculate minimum premium
     * @dev minPremium = coverage × minPremiumBps / 10000
     * @param coverage Coverage amount in USD
     * @param minPremiumBps Minimum premium in basis points
     * @return minPremium Minimum premium amount
     */
    function calculateMinPremium(
        uint256 coverage,
        uint32 minPremiumBps
    ) internal pure returns (uint256 minPremium) {
        return (coverage * minPremiumBps) / BPS;
    }

    /**
     * @notice Calculate gross premium with multipliers
     * @dev grossPremium = EL × marketMultiplier × bookMultiplier / 1e8
     * @param expectedLoss Expected loss amount
     * @param marketMultiplierBps Market multiplier (10000 = 1.0x)
     * @param bookMultiplierBps Book multiplier (10000 = 1.0x)
     * @return grossPremium Gross premium before floor
     */
    function calculateGrossPremium(
        uint256 expectedLoss,
        uint256 marketMultiplierBps,
        uint256 bookMultiplierBps
    ) internal pure returns (uint256 grossPremium) {
        // Multiply by both multipliers (each in BPS, so divide by BPS^2)
        return (expectedLoss * marketMultiplierBps * bookMultiplierBps) / (BPS * BPS);
    }

    /**
     * @notice Calculate final premium (max of gross and min)
     * @param grossPremium Gross premium from calculateGrossPremium
     * @param minPremium Minimum premium from calculateMinPremium
     * @return finalPremium Final premium (max of gross, min)
     */
    function calculateFinalPremium(
        uint256 grossPremium,
        uint256 minPremium
    ) internal pure returns (uint256 finalPremium) {
        return grossPremium > minPremium ? grossPremium : minPremium;
    }
}
