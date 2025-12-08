// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IDsrptHazardEngine} from "../interfaces/IDsrptHazardEngine.sol";
import {HazardMath} from "../libraries/HazardMath.sol";
import {PayoutCurves} from "../libraries/PayoutCurves.sol";

/**
 * @title DsrptHazardEngine
 * @notice Core pricing engine for parametric insurance using regime-based hazard curves
 * @dev Implements gas-efficient hazard interpolation with multi-factor risk adjustments
 *
 * Architecture:
 * - Regime-based hazard curves (Calm/Volatile/Crisis)
 * - Market risk multiplier from oracle state (peg deviation, volatility, shock)
 * - Book risk multiplier from portfolio/tranche utilization
 * - Parametric payout curves with severity and duration factors
 */
contract DsrptHazardEngine is IDsrptHazardEngine {
    using HazardMath for IDsrptHazardEngine.HazardTerm[3];
    using PayoutCurves for IDsrptHazardEngine.PayoutCurve;

    // ============ STORAGE ============

    /// @notice Mapping of peril ID to curve configuration
    mapping(bytes32 => CurveConfig) private _curveConfigs;

    /// @notice Mapping of peril ID to oracle state
    mapping(bytes32 => OracleState) private _oracleStates;

    /// @notice Mapping of peril ID to portfolio state
    mapping(bytes32 => PortfolioState) private _portfolioStates;

    /// @notice Mapping of peril ID to tranche state
    mapping(bytes32 => TrancheState) private _trancheStates;

    /// @notice Mapping of peril ID to payout curve
    mapping(bytes32 => PayoutCurve) private _payoutCurves;

    /// @notice Mapping of peril ID to pending regime transition
    mapping(bytes32 => RegimeTransition) private _pendingTransitions;

    /// @notice Set of configured peril IDs
    mapping(bytes32 => bool) private _configuredPerils;

    // ============ ACCESS CONTROL ============

    /// @notice Contract owner (governance)
    address public owner;

    /// @notice Keeper address for oracle updates
    address public keeper;

    /// @notice Treasury manager address for portfolio/tranche updates
    address public treasuryManager;

    /// @notice Risk oracle address for regime proposals
    address public riskOracle;

    // ============ CONSTANTS ============

    /// @dev Timelock for Crisis -> Volatile transition
    uint32 private constant CRISIS_TO_VOLATILE_DELAY = 7 days;

    /// @dev Timelock for Volatile -> Calm transition
    uint32 private constant VOLATILE_TO_CALM_DELAY = 3 days;

    /// @dev Timelock for Crisis -> Calm (two-step required)
    uint32 private constant CRISIS_TO_CALM_DELAY = 14 days;

    // ============ MODIFIERS ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    modifier onlyKeeper() {
        if (msg.sender != keeper && msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    modifier onlyTreasuryManager() {
        if (msg.sender != treasuryManager && msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    modifier onlyRiskOracle() {
        if (msg.sender != riskOracle && msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    modifier perilExists(bytes32 perilId) {
        if (!_configuredPerils[perilId]) revert PerilNotConfigured(perilId);
        _;
    }

    // ============ CONSTRUCTOR ============

    constructor(
        address _keeper,
        address _treasuryManager,
        address _riskOracle
    ) {
        owner = msg.sender;
        keeper = _keeper;
        treasuryManager = _treasuryManager;
        riskOracle = _riskOracle;
    }

    // ============ VIEW FUNCTIONS ============

    /// @inheritdoc IDsrptHazardEngine
    function getCurveConfig(bytes32 perilId)
        external
        view
        override
        returns (CurveConfig memory config)
    {
        return _curveConfigs[perilId];
    }

    /// @inheritdoc IDsrptHazardEngine
    function getCurrentRegime(bytes32 perilId)
        external
        view
        override
        returns (RegimeKind regime)
    {
        return _curveConfigs[perilId].regime;
    }

    /// @inheritdoc IDsrptHazardEngine
    function getRegimeCurve(bytes32 perilId, RegimeKind regime)
        external
        view
        override
        returns (RegimeCurve memory curve)
    {
        return _curveConfigs[perilId].regimeCurves[uint256(regime)];
    }

    /// @inheritdoc IDsrptHazardEngine
    function getOracleState(bytes32 perilId)
        external
        view
        override
        returns (OracleState memory state)
    {
        return _oracleStates[perilId];
    }

    /// @inheritdoc IDsrptHazardEngine
    function getPortfolioState(bytes32 perilId)
        external
        view
        override
        returns (PortfolioState memory state)
    {
        return _portfolioStates[perilId];
    }

    /// @inheritdoc IDsrptHazardEngine
    function getTrancheState(bytes32 perilId)
        external
        view
        override
        returns (TrancheState memory state)
    {
        return _trancheStates[perilId];
    }

    /// @inheritdoc IDsrptHazardEngine
    function getPayoutCurve(bytes32 perilId)
        external
        view
        override
        returns (PayoutCurve memory curve)
    {
        return _payoutCurves[perilId];
    }

    /// @inheritdoc IDsrptHazardEngine
    function getPendingTransition(bytes32 perilId)
        external
        view
        override
        returns (RegimeTransition memory transition)
    {
        return _pendingTransitions[perilId];
    }

    // ============ PRICING FUNCTIONS ============

    /// @inheritdoc IDsrptHazardEngine
    function quotePremium(
        bytes32 perilId,
        uint256 tenorDays,
        uint256 limitUSD
    ) external view override perilExists(perilId) returns (uint256 premiumUSD) {
        (, , , premiumUSD) = _quotePremiumDetailed(perilId, tenorDays, limitUSD);
    }

    /// @inheritdoc IDsrptHazardEngine
    function quoteDailyPremium(
        bytes32 perilId,
        uint256 coveredBalance
    ) external view override perilExists(perilId) returns (uint256 dailyPremium) {
        (, , , dailyPremium) = _quotePremiumDetailed(perilId, 1, coveredBalance);
    }

    /// @inheritdoc IDsrptHazardEngine
    function quotePremiumDetailed(
        bytes32 perilId,
        uint256 tenorDays,
        uint256 limitUSD
    ) external view override perilExists(perilId) returns (
        uint256 baseEL,
        uint256 marketMultiplier,
        uint256 bookMultiplier,
        uint256 finalPremium
    ) {
        return _quotePremiumDetailed(perilId, tenorDays, limitUSD);
    }

    /**
     * @dev Internal implementation of premium calculation
     */
    function _quotePremiumDetailed(
        bytes32 perilId,
        uint256 tenorDays,
        uint256 limitUSD
    ) internal view returns (
        uint256 baseEL,
        uint256 marketMultiplier,
        uint256 bookMultiplier,
        uint256 finalPremium
    ) {
        CurveConfig storage cfg = _curveConfigs[perilId];

        // 1. Get active regime curve
        RegimeCurve storage regimeCurve = cfg.regimeCurves[uint256(cfg.regime)];

        // 2. Interpolate H(tenorDays)
        uint256 H1e18 = HazardMath.interpolateH(
            regimeCurve.terms,
            regimeCurve.tailSlope1e18,
            tenorDays
        );

        // 3. Calculate base expected loss
        baseEL = HazardMath.calculateExpectedLoss(limitUSD, H1e18);

        // 4. Get market multiplier from oracle state
        OracleState storage os = _oracleStates[perilId];
        marketMultiplier = HazardMath.calculateMarketMultiplier(
            os,
            cfg.maxMultiplierBps,
            block.timestamp
        );

        // 5. Get book multiplier from portfolio/tranche state
        PortfolioState storage ps = _portfolioStates[perilId];
        TrancheState storage ts = _trancheStates[perilId];
        bookMultiplier = HazardMath.calculateBookMultiplier(ps, ts);

        // 6. Calculate gross premium
        uint256 grossPremium = HazardMath.calculateGrossPremium(baseEL, marketMultiplier, bookMultiplier);

        // 7. Calculate minimum premium
        uint256 minPremium = HazardMath.calculateMinPremium(limitUSD, cfg.minPremiumBps);

        // 8. Return max of gross and min
        finalPremium = HazardMath.calculateFinalPremium(grossPremium, minPremium);
    }

    // ============ PAYOUT FUNCTIONS ============

    /// @inheritdoc IDsrptHazardEngine
    function calculatePayout(
        bytes32 perilId,
        uint256 policyLimit,
        uint256 depegBps,
        uint256 durationHours
    ) external view override perilExists(perilId) returns (uint256 payout) {
        (payout, , ) = _calculatePayoutDetailed(perilId, policyLimit, depegBps, durationHours);
    }

    /// @inheritdoc IDsrptHazardEngine
    function calculatePayoutDetailed(
        bytes32 perilId,
        uint256 policyLimit,
        uint256 depegBps,
        uint256 durationHours
    ) external view override perilExists(perilId) returns (
        uint256 payout,
        uint256 severityFactor,
        uint256 durationFactor
    ) {
        return _calculatePayoutDetailed(perilId, policyLimit, depegBps, durationHours);
    }

    /**
     * @dev Internal implementation of payout calculation
     */
    function _calculatePayoutDetailed(
        bytes32 perilId,
        uint256 policyLimit,
        uint256 depegBps,
        uint256 durationHours
    ) internal view returns (
        uint256 payout,
        uint256 severityFactor,
        uint256 durationFactor
    ) {
        PayoutCurve storage curve = _payoutCurves[perilId];
        return curve.calculatePayout(policyLimit, depegBps, durationHours);
    }

    // ============ STATE UPDATE FUNCTIONS ============

    /// @inheritdoc IDsrptHazardEngine
    function pushOracleState(
        bytes32 perilId,
        OracleState calldata state
    ) external override onlyKeeper perilExists(perilId) {
        OracleState storage current = _oracleStates[perilId];

        // Validate monotonic timestamp
        require(state.updatedAt > current.updatedAt, "Timestamp must be monotonic");
        require(state.updatedAt <= block.timestamp, "Future timestamp");

        _oracleStates[perilId] = state;

        emit OracleStateUpdated(
            perilId,
            state.updatedAt,
            state.pegDevBps,
            state.volBps,
            state.shockFlag
        );
    }

    /// @inheritdoc IDsrptHazardEngine
    function pushPortfolioState(
        bytes32 perilId,
        PortfolioState calldata state
    ) external override onlyTreasuryManager perilExists(perilId) {
        _portfolioStates[perilId] = state;

        emit PortfolioStateUpdated(
            perilId,
            state.utilizationBps,
            state.capitalRatioBps,
            state.perilConcentrationBps
        );
    }

    /// @inheritdoc IDsrptHazardEngine
    function pushTrancheState(
        bytes32 perilId,
        TrancheState calldata state
    ) external override onlyTreasuryManager perilExists(perilId) {
        _trancheStates[perilId] = state;

        emit TrancheStateUpdated(
            perilId,
            state.juniorUtilBps,
            state.mezzUtilBps,
            state.seniorUtilBps
        );
    }

    // ============ GOVERNANCE FUNCTIONS ============

    /// @inheritdoc IDsrptHazardEngine
    function setCurveConfig(CurveConfig calldata config) external override onlyOwner {
        bytes32 perilId = config.perilId;

        // Validate curve parameters
        _validateCurveConfig(config);

        _curveConfigs[perilId] = config;
        _configuredPerils[perilId] = true;

        emit CurveConfigUpdated(
            perilId,
            config.regime,
            config.minPremiumBps,
            config.maxMultiplierBps
        );

        // Emit events for each regime curve
        for (uint256 i = 0; i < 3; i++) {
            RegimeCurve memory rc = config.regimeCurves[i];
            emit RegimeCurveUpdated(
                perilId,
                RegimeKind(i),
                rc.terms[0].H1e18,
                rc.terms[1].H1e18,
                rc.terms[2].H1e18,
                rc.tailSlope1e18
            );
        }
    }

    /// @inheritdoc IDsrptHazardEngine
    function setRegimeCurve(
        bytes32 perilId,
        RegimeKind regime,
        RegimeCurve calldata curve
    ) external override onlyOwner perilExists(perilId) {
        _validateRegimeCurve(curve);

        _curveConfigs[perilId].regimeCurves[uint256(regime)] = curve;

        emit RegimeCurveUpdated(
            perilId,
            regime,
            curve.terms[0].H1e18,
            curve.terms[1].H1e18,
            curve.terms[2].H1e18,
            curve.tailSlope1e18
        );
    }

    /// @inheritdoc IDsrptHazardEngine
    function setPayoutCurve(
        bytes32 perilId,
        PayoutCurve calldata curve
    ) external override onlyOwner perilExists(perilId) {
        require(PayoutCurves.validateCurve(curve), "Invalid payout curve");

        _payoutCurves[perilId] = curve;

        emit PayoutCurveUpdated(
            perilId,
            curve.maxDeviationBps,
            curve.thresholdHours,
            curve.severityExponent
        );
    }

    /// @inheritdoc IDsrptHazardEngine
    function proposeRegimeChange(
        bytes32 perilId,
        RegimeKind newRegime
    ) external override onlyRiskOracle perilExists(perilId) {
        RegimeKind currentRegime = _curveConfigs[perilId].regime;

        if (newRegime == currentRegime) {
            revert InvalidRegimeTransition(currentRegime, newRegime);
        }

        uint32 delay = _calculateRegimeTransitionDelay(currentRegime, newRegime);
        uint32 effectiveAt = uint32(block.timestamp) + delay;

        // If upgrade (to higher risk), execute immediately
        if (delay == 0) {
            _executeRegimeChange(perilId, currentRegime, newRegime);
            return;
        }

        // Store pending transition
        _pendingTransitions[perilId] = RegimeTransition({
            targetRegime: newRegime,
            proposedAt: uint32(block.timestamp),
            effectiveAt: effectiveAt,
            proposer: msg.sender
        });

        emit RegimeChangeProposed(perilId, currentRegime, newRegime, effectiveAt, msg.sender);
    }

    /// @inheritdoc IDsrptHazardEngine
    function executeRegimeChange(bytes32 perilId) external override perilExists(perilId) {
        RegimeTransition storage transition = _pendingTransitions[perilId];

        if (transition.effectiveAt == 0) {
            revert NoTransitionPending(perilId);
        }

        if (block.timestamp < transition.effectiveAt) {
            revert TimelockActive(transition.effectiveAt, uint32(block.timestamp));
        }

        RegimeKind oldRegime = _curveConfigs[perilId].regime;
        RegimeKind newRegime = transition.targetRegime;

        // Clear pending transition
        delete _pendingTransitions[perilId];

        // Execute the change
        _executeRegimeChange(perilId, oldRegime, newRegime);
    }

    /// @inheritdoc IDsrptHazardEngine
    function cancelRegimeChange(bytes32 perilId) external override onlyOwner perilExists(perilId) {
        delete _pendingTransitions[perilId];
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Transfer ownership
     * @param newOwner New owner address
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    /**
     * @notice Set keeper address
     * @param newKeeper New keeper address
     */
    function setKeeper(address newKeeper) external onlyOwner {
        keeper = newKeeper;
    }

    /**
     * @notice Set treasury manager address
     * @param newTreasuryManager New treasury manager address
     */
    function setTreasuryManager(address newTreasuryManager) external onlyOwner {
        treasuryManager = newTreasuryManager;
    }

    /**
     * @notice Set risk oracle address
     * @param newRiskOracle New risk oracle address
     */
    function setRiskOracle(address newRiskOracle) external onlyOwner {
        riskOracle = newRiskOracle;
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Calculate timelock delay for regime transition
     */
    function _calculateRegimeTransitionDelay(
        RegimeKind from,
        RegimeKind to
    ) internal pure returns (uint32 delay) {
        // Upgrades (to higher risk) are immediate
        if (uint256(to) > uint256(from)) {
            return 0;
        }

        // Downgrades have timelocks
        if (from == RegimeKind.Crisis && to == RegimeKind.Volatile) {
            return CRISIS_TO_VOLATILE_DELAY;
        } else if (from == RegimeKind.Volatile && to == RegimeKind.Calm) {
            return VOLATILE_TO_CALM_DELAY;
        } else if (from == RegimeKind.Crisis && to == RegimeKind.Calm) {
            return CRISIS_TO_CALM_DELAY;
        }

        return 0;
    }

    /**
     * @dev Execute regime change
     */
    function _executeRegimeChange(
        bytes32 perilId,
        RegimeKind oldRegime,
        RegimeKind newRegime
    ) internal {
        _curveConfigs[perilId].regime = newRegime;
        emit RegimeChangeExecuted(perilId, oldRegime, newRegime);
    }

    /**
     * @dev Validate curve configuration
     */
    function _validateCurveConfig(CurveConfig calldata config) internal pure {
        require(config.perilId != bytes32(0), "Invalid peril ID");
        require(config.minPremiumBps > 0 && config.minPremiumBps <= 10000, "Invalid min premium");
        require(config.maxMultiplierBps >= 10000 && config.maxMultiplierBps <= 50000, "Invalid max multiplier");

        // Validate all regime curves
        for (uint256 i = 0; i < 3; i++) {
            _validateRegimeCurve(config.regimeCurves[i]);
        }
    }

    /**
     * @dev Validate regime curve
     */
    function _validateRegimeCurve(RegimeCurve memory curve) internal pure {
        // Validate term tenors are correct
        require(curve.terms[0].tenorDays == 7, "First term must be 7 days");
        require(curve.terms[1].tenorDays == 30, "Second term must be 30 days");
        require(curve.terms[2].tenorDays == 90, "Third term must be 90 days");

        // Validate hazard values are monotonically increasing
        require(curve.terms[0].H1e18 <= curve.terms[1].H1e18, "H(7) > H(30)");
        require(curve.terms[1].H1e18 <= curve.terms[2].H1e18, "H(30) > H(90)");
    }
}
