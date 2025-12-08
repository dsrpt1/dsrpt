// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IDsrptHazardEngine
 * @notice Core pricing engine for parametric insurance using regime-based hazard curves
 * @dev Implements gas-efficient hazard interpolation with multi-factor risk adjustments
 */
interface IDsrptHazardEngine {

    // ============ ENUMS ============

    /**
     * @notice Market regime classifications
     * @dev Higher enum value = higher risk regime
     */
    enum RegimeKind {
        Calm,       // Normal market conditions
        Volatile,   // Elevated but manageable risk
        Crisis      // Extreme risk conditions
    }

    // ============ STRUCTS ============

    /**
     * @notice Single point on hazard curve
     * @param tenorDays Term length in days (e.g., 7, 30, 90)
     * @param H1e18 Cumulative hazard H(T) scaled by 1e18
     */
    struct HazardTerm {
        uint32 tenorDays;
        uint224 H1e18;
    }

    /**
     * @notice Complete hazard curve for one regime
     * @param terms Fixed array of 3 calibration points [7d, 30d, 90d]
     * @param tailSlope1e18 Hazard rate dH/dT for T > 90 days, scaled by 1e18
     */
    struct RegimeCurve {
        HazardTerm[3] terms;
        uint224 tailSlope1e18;
    }

    /**
     * @notice Complete configuration for one peril
     * @param perilId Unique identifier (e.g., keccak256("USDC_depeg"))
     * @param minPremiumBps Absolute floor on premium in basis points
     * @param maxMultiplierBps Ceiling on combined risk multipliers (e.g., 30000 = 3.0x)
     * @param regime Currently active regime
     * @param regimeCurves Array of curves indexed by RegimeKind
     */
    struct CurveConfig {
        bytes32 perilId;
        uint32 minPremiumBps;
        uint32 maxMultiplierBps;
        RegimeKind regime;
        RegimeCurve[3] regimeCurves;
    }

    /**
     * @notice Compressed oracle state for market conditions
     * @param updatedAt Timestamp of last keeper update
     * @param pegDevBps Absolute deviation from peg in basis points
     * @param volBps Realized volatility proxy in basis points
     * @param disagreementBps Maximum cross-venue spread in basis points
     * @param shockFlag 0=normal, 1=warning, 2=shock
     */
    struct OracleState {
        uint32 updatedAt;
        uint16 pegDevBps;
        uint16 volBps;
        uint16 disagreementBps;
        uint8 shockFlag;
    }

    /**
     * @notice Portfolio capital health metrics
     * @param utilizationBps Liabilities / Assets (0-10000)
     * @param capitalRatioBps Available Capital / Required TVaR (0-20000+)
     * @param perilConcentrationBps Single peril exposure / Total book (0-10000)
     */
    struct PortfolioState {
        uint16 utilizationBps;
        uint16 capitalRatioBps;
        uint16 perilConcentrationBps;
    }

    /**
     * @notice Tranche utilization for risk layering
     * @param juniorUtilBps Junior tranche utilization (0-10000)
     * @param mezzUtilBps Mezzanine tranche utilization (0-10000)
     * @param seniorUtilBps Senior tranche utilization (0-10000)
     */
    struct TrancheState {
        uint16 juniorUtilBps;
        uint16 mezzUtilBps;
        uint16 seniorUtilBps;
    }

    /**
     * @notice Parametric payout curve configuration
     * @param maxDeviationBps Maximum claimable deviation (e.g., 5000 = 50%)
     * @param thresholdHours Duration for full duration factor (e.g., 168 = 7 days)
     * @param severityExponent 1=linear, 2=convex, 3=highly convex
     */
    struct PayoutCurve {
        uint32 maxDeviationBps;
        uint32 thresholdHours;
        uint8 severityExponent;
    }

    /**
     * @notice Pending regime transition with timelock
     * @param targetRegime Proposed new regime
     * @param proposedAt Timestamp of proposal
     * @param effectiveAt Timestamp when transition can execute
     * @param proposer Address that proposed the change
     */
    struct RegimeTransition {
        RegimeKind targetRegime;
        uint32 proposedAt;
        uint32 effectiveAt;
        address proposer;
    }

    // ============ EVENTS ============

    event CurveConfigUpdated(
        bytes32 indexed perilId,
        RegimeKind regime,
        uint32 minPremiumBps,
        uint32 maxMultiplierBps
    );

    event RegimeCurveUpdated(
        bytes32 indexed perilId,
        RegimeKind regime,
        uint224 H7d,
        uint224 H30d,
        uint224 H90d,
        uint224 tailSlope
    );

    event OracleStateUpdated(
        bytes32 indexed perilId,
        uint32 timestamp,
        uint16 pegDevBps,
        uint16 volBps,
        uint8 shockFlag
    );

    event PortfolioStateUpdated(
        bytes32 indexed perilId,
        uint16 utilizationBps,
        uint16 capitalRatioBps,
        uint16 concentrationBps
    );

    event TrancheStateUpdated(
        bytes32 indexed perilId,
        uint16 juniorUtil,
        uint16 mezzUtil,
        uint16 seniorUtil
    );

    event RegimeChangeProposed(
        bytes32 indexed perilId,
        RegimeKind currentRegime,
        RegimeKind targetRegime,
        uint32 effectiveAt,
        address proposer
    );

    event RegimeChangeExecuted(
        bytes32 indexed perilId,
        RegimeKind oldRegime,
        RegimeKind newRegime
    );

    event PayoutCurveUpdated(
        bytes32 indexed perilId,
        uint32 maxDeviationBps,
        uint32 thresholdHours,
        uint8 severityExponent
    );

    // ============ ERRORS ============

    error PerilNotConfigured(bytes32 perilId);
    error InvalidHazardCurve(string reason);
    error StaleOracleData(bytes32 perilId, uint32 lastUpdate);
    error ExcessiveMultiplier(uint256 computed, uint256 max);
    error InvalidRegimeTransition(RegimeKind from, RegimeKind to);
    error TimelockActive(uint32 effectiveAt, uint32 currentTime);
    error NoTransitionPending(bytes32 perilId);
    error Unauthorized(address caller);

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Get complete curve configuration for a peril
     * @param perilId Unique peril identifier
     * @return config Complete CurveConfig struct
     */
    function getCurveConfig(bytes32 perilId)
        external
        view
        returns (CurveConfig memory config);

    /**
     * @notice Get current active regime for a peril
     * @param perilId Unique peril identifier
     * @return regime Current RegimeKind
     */
    function getCurrentRegime(bytes32 perilId)
        external
        view
        returns (RegimeKind regime);

    /**
     * @notice Get specific regime curve
     * @param perilId Unique peril identifier
     * @param regime Which regime curve to retrieve
     * @return curve RegimeCurve for specified regime
     */
    function getRegimeCurve(bytes32 perilId, RegimeKind regime)
        external
        view
        returns (RegimeCurve memory curve);

    /**
     * @notice Get latest oracle state
     * @param perilId Unique peril identifier
     * @return state Current OracleState
     */
    function getOracleState(bytes32 perilId)
        external
        view
        returns (OracleState memory state);

    /**
     * @notice Get latest portfolio state
     * @param perilId Unique peril identifier
     * @return state Current PortfolioState
     */
    function getPortfolioState(bytes32 perilId)
        external
        view
        returns (PortfolioState memory state);

    /**
     * @notice Get latest tranche state
     * @param perilId Unique peril identifier
     * @return state Current TrancheState
     */
    function getTrancheState(bytes32 perilId)
        external
        view
        returns (TrancheState memory state);

    /**
     * @notice Get payout curve configuration
     * @param perilId Unique peril identifier
     * @return curve PayoutCurve configuration
     */
    function getPayoutCurve(bytes32 perilId)
        external
        view
        returns (PayoutCurve memory curve);

    /**
     * @notice Get pending regime transition if any
     * @param perilId Unique peril identifier
     * @return transition RegimeTransition struct (zero if none pending)
     */
    function getPendingTransition(bytes32 perilId)
        external
        view
        returns (RegimeTransition memory transition);

    // ============ PRICING FUNCTIONS ============

    /**
     * @notice Calculate premium for given coverage parameters
     * @param perilId Unique peril identifier
     * @param tenorDays Policy duration in days
     * @param limitUSD Coverage amount in USD (scaled by 1e6 for USDC)
     * @return premiumUSD Required premium in USD (same scaling as limitUSD)
     */
    function quotePremium(
        bytes32 perilId,
        uint256 tenorDays,
        uint256 limitUSD
    ) external view returns (uint256 premiumUSD);

    /**
     * @notice Calculate daily premium for streaming coverage
     * @dev Convenience function: quotePremium(perilId, 1, coveredBalance)
     * @param perilId Unique peril identifier
     * @param coveredBalance Current balance to insure in USD
     * @return dailyPremium Premium for one day of coverage
     */
    function quoteDailyPremium(
        bytes32 perilId,
        uint256 coveredBalance
    ) external view returns (uint256 dailyPremium);

    /**
     * @notice Calculate premium components for transparency
     * @param perilId Unique peril identifier
     * @param tenorDays Policy duration in days
     * @param limitUSD Coverage amount in USD
     * @return baseEL Base expected loss (limit × H(T))
     * @return marketMultiplier Market risk multiplier in bps (10000 = 1.0x)
     * @return bookMultiplier Book risk multiplier in bps (10000 = 1.0x)
     * @return finalPremium Final premium after all adjustments
     */
    function quotePremiumDetailed(
        bytes32 perilId,
        uint256 tenorDays,
        uint256 limitUSD
    ) external view returns (
        uint256 baseEL,
        uint256 marketMultiplier,
        uint256 bookMultiplier,
        uint256 finalPremium
    );

    // ============ PAYOUT FUNCTIONS ============

    /**
     * @notice Calculate payout for triggered policy
     * @param perilId Unique peril identifier
     * @param policyLimit Coverage limit in USD
     * @param depegBps Deviation from peg in basis points (e.g., 300 = 3%)
     * @param durationHours Duration trigger was active in hours
     * @return payout Amount to pay in USD
     */
    function calculatePayout(
        bytes32 perilId,
        uint256 policyLimit,
        uint256 depegBps,
        uint256 durationHours
    ) external view returns (uint256 payout);

    /**
     * @notice Calculate payout with component breakdown
     * @param perilId Unique peril identifier
     * @param policyLimit Coverage limit in USD
     * @param depegBps Deviation from peg in basis points
     * @param durationHours Duration trigger was active in hours
     * @return payout Final payout amount
     * @return severityFactor f(d) component (scaled by 1e18)
     * @return durationFactor g(t) component (scaled by 1e18)
     */
    function calculatePayoutDetailed(
        bytes32 perilId,
        uint256 policyLimit,
        uint256 depegBps,
        uint256 durationHours
    ) external view returns (
        uint256 payout,
        uint256 severityFactor,
        uint256 durationFactor
    );

    // ============ STATE UPDATE FUNCTIONS ============

    /**
     * @notice Update oracle state (keeper only)
     * @param perilId Unique peril identifier
     * @param state New OracleState
     */
    function pushOracleState(
        bytes32 perilId,
        OracleState calldata state
    ) external;

    /**
     * @notice Update portfolio state (treasury manager only)
     * @param perilId Unique peril identifier
     * @param state New PortfolioState
     */
    function pushPortfolioState(
        bytes32 perilId,
        PortfolioState calldata state
    ) external;

    /**
     * @notice Update tranche state (treasury manager only)
     * @param perilId Unique peril identifier
     * @param state New TrancheState
     */
    function pushTrancheState(
        bytes32 perilId,
        TrancheState calldata state
    ) external;

    // ============ GOVERNANCE FUNCTIONS ============

    /**
     * @notice Initialize or update curve configuration (governance only)
     * @param config Complete CurveConfig to set
     */
    function setCurveConfig(CurveConfig calldata config) external;

    /**
     * @notice Update specific regime curve (governance only)
     * @param perilId Unique peril identifier
     * @param regime Which regime to update
     * @param curve New RegimeCurve data
     */
    function setRegimeCurve(
        bytes32 perilId,
        RegimeKind regime,
        RegimeCurve calldata curve
    ) external;

    /**
     * @notice Update payout curve parameters (governance only)
     * @param perilId Unique peril identifier
     * @param curve New PayoutCurve configuration
     */
    function setPayoutCurve(
        bytes32 perilId,
        PayoutCurve calldata curve
    ) external;

    /**
     * @notice Propose regime change with timelock
     * @param perilId Unique peril identifier
     * @param newRegime Target regime
     * @dev Upgrades (to higher risk) are immediate, downgrades have timelock
     */
    function proposeRegimeChange(
        bytes32 perilId,
        RegimeKind newRegime
    ) external;

    /**
     * @notice Execute pending regime change after timelock
     * @param perilId Unique peril identifier
     */
    function executeRegimeChange(bytes32 perilId) external;

    /**
     * @notice Cancel pending regime transition (governance only)
     * @param perilId Unique peril identifier
     */
    function cancelRegimeChange(bytes32 perilId) external;
}
