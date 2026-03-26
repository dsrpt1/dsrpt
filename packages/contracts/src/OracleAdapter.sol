// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {HazardCurveEngine} from "./HazardCurveEngine.sol";

/**
 * @title OracleAdapter
 * @notice Bridges the off-chain signal engine to on-chain pricing.
 *
 * The core vulnerability: any latency between signal detection (Python
 * classifier_v2.py) and premium repricing (HazardCurveEngine) lets
 * sophisticated actors buy coverage at stale prices. This contract
 * eliminates that gap by atomically updating regime state AND forwarding
 * curve parameter changes to HazardCurveEngine in a single transaction.
 *
 * Regime taxonomy (from classifier_v2.py):
 *   0 AMBIGUOUS            -- insufficient signal, base pricing (1.00x)
 *   1 CONTAINED_STRESS     -- mild persistent contagion (1.25x)
 *   2 LIQUIDITY_DISLOCATION -- execution risk, not systemic (1.10x)
 *   3 COLLATERAL_SHOCK     -- sharp reserve impairment (1.50x), cap new coverage
 *   4 REFLEXIVE_COLLAPSE   -- terminal spiral, halt all new issuance
 *
 * Integration:
 *   - OracleAdapter must be owner of HazardCurveEngine so it can call setCurve()
 *   - Signal relayer (keeper/EOA) calls updateRegime() on every regime transition
 *   - PolicyManager checks isPolicyIssuanceAllowed() before writing new policies
 *   - LiquidityPool checks isWithdrawalAllowed() before processing LP withdrawals
 */
contract OracleAdapter {

    // -- Regime enum (order matches classifier_v2.py REGIME_LABELS severity) -----

    enum Regime {
        AMBIGUOUS,              // 0
        CONTAINED_STRESS,       // 1
        LIQUIDITY_DISLOCATION,  // 2
        COLLATERAL_SHOCK,       // 3
        REFLEXIVE_COLLAPSE      // 4
    }

    // -- Escalation level (derived from regime + confidence) -----

    enum EscalationLevel {
        NORMAL,      // 0
        ELEVATED,    // 1
        ESCALATING,  // 2 -- blocks new policy issuance
        CRITICAL     // 3 -- blocks new policy issuance
    }

    // -- Events -----

    event RegimeUpdated(
        address indexed asset,
        Regime  indexed newRegime,
        Regime          previousRegime,
        uint256         confidence,
        uint256         premiumMultiplierBps,
        uint256         timestamp
    );

    event EscalationChanged(
        address indexed asset,
        EscalationLevel indexed newLevel,
        EscalationLevel         previousLevel
    );

    event CoverageCapSet(address indexed asset, uint256 maxNewCoverage);
    event IssuanceHalted(address indexed asset);
    event IssuanceResumed(address indexed asset);

    // -- Per-asset state -----

    struct AssetState {
        Regime          regime;
        Regime          previousRegime;
        EscalationLevel escalation;
        uint256         confidence;           // 0-10000 bps
        uint256         premiumMultiplierBps; // 10000 = 1.00x
        uint256         lastRegimeTransition; // block.timestamp of last change
        uint256         lastUpdateBlock;      // block.number for stale-price guard
        uint256         maxNewCoverage;       // 0 = unlimited, >0 = cap in wei
        bool            issuanceHalted;
    }

    // -- Storage for base curve parameters (before regime adjustment) -----

    struct BaseCurveParams {
        uint256 baseProbPerDay;
        uint256 slopePerDay;
        uint16  minPremiumBps;
        uint16  maxMultiplierBps; // base max multiplier before regime loading
        uint16  pegThresholdBps;
        uint32  oracleStaleAfter;
    }

    // -- State -----

    address public owner;
    address public signalRelayer;
    HazardCurveEngine public hazardEngine;

    uint256 public constant LOCKUP_PERIOD = 72 hours;

    // Premium multipliers in basis points (10000 = 1.00x)
    uint256 public constant MULT_AMBIGUOUS           = 10_000; // 1.00x
    uint256 public constant MULT_CONTAINED_STRESS    = 12_500; // 1.25x
    uint256 public constant MULT_LIQUIDITY_DISLOC    = 11_000; // 1.10x
    uint256 public constant MULT_COLLATERAL_SHOCK    = 15_000; // 1.50x
    // REFLEXIVE_COLLAPSE: issuance halted, no multiplier needed

    mapping(address => AssetState)      public assetStates;
    mapping(bytes32 => BaseCurveParams) public baseCurves;
    mapping(address => bytes32)         public assetPerilIds;

    // -- Modifiers -----

    modifier onlyOwner() {
        require(msg.sender == owner, "OracleAdapter: not owner");
        _;
    }

    modifier onlyRelayer() {
        require(msg.sender == signalRelayer, "OracleAdapter: not relayer");
        _;
    }

    // -- Constructor -----

    constructor(address _signalRelayer, address _hazardEngine) {
        require(_signalRelayer != address(0), "OracleAdapter: zero relayer");
        require(_hazardEngine != address(0), "OracleAdapter: zero engine");

        owner         = msg.sender;
        signalRelayer = _signalRelayer;
        hazardEngine  = HazardCurveEngine(_hazardEngine);
    }

    // =========================================================================
    // Setup: register asset -> perilId mapping and store base curve params
    // =========================================================================

    /**
     * @notice Register an asset with its peril ID and store the base curve params.
     *         The OracleAdapter will adjust maxMultiplierBps on regime transitions.
     * @dev    OracleAdapter must be owner of HazardCurveEngine.
     */
    function registerAsset(
        address asset,
        bytes32 perilId,
        uint256 baseProbPerDay,
        uint256 slopePerDay,
        uint16  minPremiumBps,
        uint16  maxMultiplierBps,
        uint16  pegThresholdBps,
        uint32  oracleStaleAfter
    ) external onlyOwner {
        assetPerilIds[asset] = perilId;

        baseCurves[perilId] = BaseCurveParams({
            baseProbPerDay:   baseProbPerDay,
            slopePerDay:      slopePerDay,
            minPremiumBps:    minPremiumBps,
            maxMultiplierBps: maxMultiplierBps,
            pegThresholdBps:  pegThresholdBps,
            oracleStaleAfter: oracleStaleAfter
        });

        // Set the initial curve on HazardCurveEngine (active, base multiplier)
        hazardEngine.setCurve(
            perilId,
            baseProbPerDay,
            slopePerDay,
            minPremiumBps,
            maxMultiplierBps,
            pegThresholdBps,
            oracleStaleAfter,
            true
        );
    }

    // =========================================================================
    // Core: Atomic Regime Update
    // =========================================================================
    //
    // Critical path. The relayer calls updateRegime() and the contract:
    //   1. Records new regime + confidence
    //   2. Computes premium multiplier
    //   3. Adjusts HazardCurveEngine curve via setCurve() in the SAME tx
    //   4. Updates escalation level and issuance gates
    //   5. Starts 72h lockup timer if regime changed
    //
    // Zero latency: signal -> pricing update in one atomic transaction.
    // No block gap. No mempool exposure of the signal before repricing.

    function updateRegime(
        address asset,
        uint8   regimeId,
        uint256 confidence   // 0-10000
    ) external onlyRelayer {
        require(regimeId <= uint8(Regime.REFLEXIVE_COLLAPSE), "OracleAdapter: invalid regime");
        require(confidence <= 10_000, "OracleAdapter: confidence out of range");

        bytes32 perilId = assetPerilIds[asset];
        require(perilId != bytes32(0), "OracleAdapter: asset not registered");

        Regime newRegime = Regime(regimeId);
        AssetState storage state = assetStates[asset];

        Regime prevRegime = state.regime;
        bool regimeChanged = (newRegime != prevRegime) || (state.lastUpdateBlock == 0);

        // 1. Update regime state
        state.previousRegime      = prevRegime;
        state.regime              = newRegime;
        state.confidence          = confidence;
        state.lastUpdateBlock     = block.number;

        // 2. Compute premium multiplier
        uint256 multiplier = _premiumMultiplier(newRegime);
        state.premiumMultiplierBps = multiplier;

        // 3. Handle regime-specific controls (halt, caps)
        _applyRegimeControls(asset, state, newRegime);

        // 4. Derive escalation level
        EscalationLevel prevEscalation = state.escalation;
        state.escalation = _deriveEscalation(newRegime, confidence);

        // 5. Start lockup on regime transition
        if (regimeChanged) {
            state.lastRegimeTransition = block.timestamp;
        }

        // 6. ATOMIC: adjust HazardCurveEngine curve in the same transaction.
        //    Scale the base maxMultiplierBps by the regime loading factor.
        //    For REFLEXIVE_COLLAPSE, deactivate the curve entirely.
        _syncHazardEngine(perilId, newRegime, multiplier);

        // 7. Emit events
        emit RegimeUpdated(
            asset, newRegime, prevRegime, confidence, multiplier, block.timestamp
        );

        if (state.escalation != prevEscalation) {
            emit EscalationChanged(asset, state.escalation, prevEscalation);
        }
    }

    // =========================================================================
    // HazardCurveEngine Sync
    // =========================================================================

    function _syncHazardEngine(
        bytes32 perilId,
        Regime  regime,
        uint256 regimeMultiplierBps
    ) internal {
        BaseCurveParams memory base = baseCurves[perilId];

        if (regime == Regime.REFLEXIVE_COLLAPSE) {
            // Deactivate curve -- no new premiums can be quoted
            hazardEngine.setCurve(
                perilId,
                base.baseProbPerDay,
                base.slopePerDay,
                base.minPremiumBps,
                base.maxMultiplierBps,
                base.pegThresholdBps,
                base.oracleStaleAfter,
                false  // <-- inactive
            );
            return;
        }

        // Scale maxMultiplierBps by regime loading:
        //   adjusted = base.maxMultiplierBps * regimeMultiplierBps / 10000
        // e.g. base 30000 (3x) * 12500 (1.25x regime) / 10000 = 37500 (3.75x)
        uint256 adjusted = uint256(base.maxMultiplierBps) * regimeMultiplierBps / 10_000;

        // Cap to uint16 max (65535 = 6.5535x) -- safe for all defined regimes
        uint16 adjustedMultBps = adjusted > type(uint16).max
            ? type(uint16).max
            : uint16(adjusted);

        // Also scale minPremiumBps by regime loading
        uint256 adjustedMin = uint256(base.minPremiumBps) * regimeMultiplierBps / 10_000;
        uint16 adjustedMinBps = adjustedMin > type(uint16).max
            ? type(uint16).max
            : uint16(adjustedMin);

        hazardEngine.setCurve(
            perilId,
            base.baseProbPerDay,
            base.slopePerDay,
            adjustedMinBps,
            adjustedMultBps,
            base.pegThresholdBps,
            base.oracleStaleAfter,
            true
        );
    }

    // =========================================================================
    // Premium Multiplier Logic
    // =========================================================================

    function _premiumMultiplier(Regime regime) internal pure returns (uint256) {
        if (regime == Regime.AMBIGUOUS)             return MULT_AMBIGUOUS;
        if (regime == Regime.CONTAINED_STRESS)      return MULT_CONTAINED_STRESS;
        if (regime == Regime.LIQUIDITY_DISLOCATION) return MULT_LIQUIDITY_DISLOC;
        if (regime == Regime.COLLATERAL_SHOCK)      return MULT_COLLATERAL_SHOCK;
        // REFLEXIVE_COLLAPSE -- issuance halted; return max as a poison value
        return type(uint256).max;
    }

    // =========================================================================
    // Regime-Specific Controls
    // =========================================================================

    function _applyRegimeControls(
        address asset,
        AssetState storage state,
        Regime regime
    ) internal {
        if (regime == Regime.REFLEXIVE_COLLAPSE) {
            if (!state.issuanceHalted) {
                state.issuanceHalted = true;
                emit IssuanceHalted(asset);
            }
            state.maxNewCoverage = 0;
        } else if (regime == Regime.COLLATERAL_SHOCK) {
            // Lift halt if recovering from collapse, but keep coverage cap
            if (state.issuanceHalted) {
                state.issuanceHalted = false;
                emit IssuanceResumed(asset);
            }
            // Coverage cap is set externally via setCoverageCap()
        } else {
            if (state.issuanceHalted) {
                state.issuanceHalted = false;
                emit IssuanceResumed(asset);
            }
            state.maxNewCoverage = 0; // 0 = unlimited
        }
    }

    // =========================================================================
    // Escalation Derivation
    // =========================================================================

    function _deriveEscalation(
        Regime  regime,
        uint256 confidence
    ) internal pure returns (EscalationLevel) {
        if (regime == Regime.REFLEXIVE_COLLAPSE) return EscalationLevel.CRITICAL;

        if (regime == Regime.COLLATERAL_SHOCK) {
            return confidence > 7_000
                ? EscalationLevel.ESCALATING
                : EscalationLevel.ELEVATED;
        }

        if (regime == Regime.CONTAINED_STRESS) {
            return confidence > 8_000
                ? EscalationLevel.ESCALATING
                : EscalationLevel.ELEVATED;
        }

        if (regime == Regime.LIQUIDITY_DISLOCATION) return EscalationLevel.ELEVATED;

        return EscalationLevel.NORMAL;
    }

    // =========================================================================
    // External View Functions
    // =========================================================================

    function getCurrentRegime(address asset)
        external view returns (uint8 regime, uint256 confidence)
    {
        AssetState storage state = assetStates[asset];
        return (uint8(state.regime), state.confidence);
    }

    /**
     * @notice PolicyManager calls this before writing a new policy.
     *         Returns false during ESCALATING, CRITICAL, or explicit halt.
     */
    function isPolicyIssuanceAllowed(address asset) external view returns (bool) {
        AssetState storage state = assetStates[asset];

        if (state.escalation >= EscalationLevel.ESCALATING) return false;
        if (state.issuanceHalted) return false;

        return true;
    }

    function getPremiumMultiplier(address asset) external view returns (uint256) {
        return assetStates[asset].premiumMultiplierBps;
    }

    function getEscalationLevel(address asset) external view returns (uint8) {
        return uint8(assetStates[asset].escalation);
    }

    // =========================================================================
    // LP Withdrawal Lockup (72h)
    // =========================================================================
    //
    // After ANY regime transition, LP withdrawals are locked for 72 hours.
    // Prevents LPs from front-running a deepening crisis by pulling capital
    // after the signal fires but before claims materialize.

    function isWithdrawalAllowed(address asset) external view returns (bool) {
        uint256 lastTransition = assetStates[asset].lastRegimeTransition;
        if (lastTransition == 0) return true;
        return block.timestamp > lastTransition + LOCKUP_PERIOD;
    }

    function timeUntilWithdrawalUnlock(address asset) external view returns (uint256) {
        uint256 lastTransition = assetStates[asset].lastRegimeTransition;
        if (lastTransition == 0) return 0;

        uint256 unlockTime = lastTransition + LOCKUP_PERIOD;
        if (block.timestamp >= unlockTime) return 0;

        return unlockTime - block.timestamp;
    }

    // =========================================================================
    // Coverage Cap Management
    // =========================================================================

    function setCoverageCap(address asset, uint256 maxCoverage) external onlyOwner {
        assetStates[asset].maxNewCoverage = maxCoverage;
        emit CoverageCapSet(asset, maxCoverage);
    }

    function getCoverageCap(address asset) external view returns (uint256) {
        return assetStates[asset].maxNewCoverage;
    }

    // =========================================================================
    // Admin
    // =========================================================================

    function setSignalRelayer(address _relayer) external onlyOwner {
        require(_relayer != address(0), "OracleAdapter: zero relayer");
        signalRelayer = _relayer;
    }

    function setHazardEngine(address _engine) external onlyOwner {
        require(_engine != address(0), "OracleAdapter: zero engine");
        hazardEngine = HazardCurveEngine(_engine);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "OracleAdapter: zero owner");
        owner = newOwner;
    }
}
