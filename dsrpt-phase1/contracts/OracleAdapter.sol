// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * Dsrpt Protocol — OracleAdapter
 *
 * Closes the adverse selection gap between signal detection and pricing update.
 * The terminal's SignalEngine emits regime transitions; this contract receives them
 * and atomically reprices the HazardCurveEngine in the same transaction.
 *
 * Attack surface: any latency between "terminal knows" and "protocol reprices"
 * lets sophisticated actors buy coverage at stale prices. This contract ensures
 * regime state and premium loading update in a single atomic call.
 *
 * Regime taxonomy (from classifier_v2.py):
 *   AMBIGUOUS            — insufficient signal, base pricing
 *   CONTAINED_STRESS     — mild persistent contagion, 1.25× loading
 *   COLLATERAL_SHOCK     — sharp reserve impairment, 1.50× loading + coverage cap
 *   REFLEXIVE_COLLAPSE   — terminal spiral, halt all new issuance
 */

// ─────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────

interface IHazardCurveEngine {
    function updateRegime(
        address asset,
        uint8   regime,
        uint256 confidence,
        uint256 premiumMultiplierBps
    ) external;
}

// ─────────────────────────────────────────────
// OracleAdapter
// ─────────────────────────────────────────────

contract OracleAdapter {

    // ── Regime Enum ──────────────────────────
    // Order matches classifier_v2.py severity escalation.
    // Using uint8 instead of strings: cheaper, no keccak comparisons,
    // and the regime set is closed (5 members, won't change without a
    // contract upgrade).

    enum Regime {
        AMBIGUOUS,             // 0 — default / insufficient signal
        CONTAINED_STRESS,      // 1
        LIQUIDITY_DISLOCATION, // 2
        COLLATERAL_SHOCK,      // 3
        REFLEXIVE_COLLAPSE     // 4 — terminal, halt issuance
    }

    // ── Escalation Level ─────────────────────
    // Derived from regime + confidence. Policy issuance blocked at
    // ESCALATING and CRITICAL.

    enum EscalationLevel {
        NORMAL,      // 0
        ELEVATED,    // 1
        ESCALATING,  // 2 — blocks new policy issuance
        CRITICAL     // 3 — blocks new policy issuance
    }

    // ── Events ───────────────────────────────

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

    event CoverageCapSet(
        address indexed asset,
        uint256         maxNewCoverage
    );

    event IssuanceHalted(address indexed asset);
    event IssuanceResumed(address indexed asset);

    // ── State ────────────────────────────────

    struct AssetState {
        Regime          regime;
        Regime          previousRegime;
        EscalationLevel escalation;
        uint256         confidence;          // scaled 0–10000 (basis points)
        uint256         premiumMultiplierBps;// 10000 = 1.00×
        uint256         lastRegimeTransition;// block.timestamp of last transition
        uint256         lastUpdateBlock;     // block.number — stale-price guard
        uint256         maxNewCoverage;      // 0 = unlimited, >0 = cap in wei
        bool            issuanceHalted;
    }

    address public owner;
    address public signalRelayer;            // EOA or keeper that relays from terminal
    IHazardCurveEngine public hazardEngine;

    uint256 public constant LOCKUP_PERIOD = 72 hours;

    // Premium multipliers in basis points (10000 = 1.00×)
    uint256 public constant MULT_AMBIGUOUS           = 10000; // 1.00×
    uint256 public constant MULT_CONTAINED_STRESS    = 12500; // 1.25×
    uint256 public constant MULT_LIQUIDITY_DISLOC    = 11000; // 1.10×
    uint256 public constant MULT_COLLATERAL_SHOCK    = 15000; // 1.50×
    // REFLEXIVE_COLLAPSE has no multiplier — issuance is halted entirely.

    mapping(address => AssetState) public assetStates;

    // ── Modifiers ────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "OracleAdapter: not owner");
        _;
    }

    modifier onlyRelayer() {
        require(msg.sender == signalRelayer, "OracleAdapter: not relayer");
        _;
    }

    // ── Constructor ──────────────────────────

    constructor(address _signalRelayer, address _hazardEngine) {
        require(_signalRelayer != address(0), "OracleAdapter: zero relayer");
        require(_hazardEngine != address(0), "OracleAdapter: zero engine");

        owner         = msg.sender;
        signalRelayer = _signalRelayer;
        hazardEngine  = IHazardCurveEngine(_hazardEngine);
    }

    // ─────────────────────────────────────────
    // Core: Atomic Regime Update
    // ─────────────────────────────────────────
    //
    // This is the critical path. The relayer calls updateRegime() and
    // the contract:
    //   1. Records new regime + confidence
    //   2. Computes premium multiplier
    //   3. Forwards to HazardCurveEngine.updateRegime() in the SAME tx
    //   4. Updates escalation level and issuance gates
    //   5. Starts 72h lockup timer if regime changed
    //
    // Zero latency: signal → pricing update in one atomic transaction.
    // No block gap. No mempool exposure of the signal before repricing.

    function updateRegime(
        address asset,
        uint8   regimeId,
        uint256 confidence   // 0–10000
    ) external onlyRelayer {
        require(regimeId <= uint8(Regime.REFLEXIVE_COLLAPSE), "OracleAdapter: invalid regime");
        require(confidence <= 10000, "OracleAdapter: confidence out of range");

        Regime newRegime = Regime(regimeId);
        AssetState storage state = assetStates[asset];

        Regime prevRegime = state.regime;
        bool regimeChanged = (newRegime != prevRegime) || (state.lastUpdateBlock == 0);

        // 1. Update regime state
        state.previousRegime = prevRegime;
        state.regime         = newRegime;
        state.confidence     = confidence;
        state.lastUpdateBlock = block.number;

        // 2. Compute premium multiplier
        uint256 multiplier = _premiumMultiplier(newRegime);
        state.premiumMultiplierBps = multiplier;

        // 3. Handle regime-specific controls
        _applyRegimeControls(asset, state, newRegime);

        // 4. Derive escalation level
        EscalationLevel prevEscalation = state.escalation;
        state.escalation = _deriveEscalation(newRegime, confidence);

        // 5. Start lockup on regime transition
        if (regimeChanged) {
            state.lastRegimeTransition = block.timestamp;
        }

        // 6. ATOMIC: forward to HazardCurveEngine in the same transaction
        //    The engine reads the new regime before any new policy can be written.
        hazardEngine.updateRegime(asset, regimeId, confidence, multiplier);

        // 7. Emit events
        emit RegimeUpdated(
            asset, newRegime, prevRegime, confidence, multiplier, block.timestamp
        );

        if (state.escalation != prevEscalation) {
            emit EscalationChanged(asset, state.escalation, prevEscalation);
        }
    }

    // ─────────────────────────────────────────
    // Premium Multiplier Logic
    // ─────────────────────────────────────────

    function _premiumMultiplier(Regime regime) internal pure returns (uint256) {
        if (regime == Regime.AMBIGUOUS)             return MULT_AMBIGUOUS;
        if (regime == Regime.CONTAINED_STRESS)      return MULT_CONTAINED_STRESS;
        if (regime == Regime.LIQUIDITY_DISLOCATION) return MULT_LIQUIDITY_DISLOC;
        if (regime == Regime.COLLATERAL_SHOCK)      return MULT_COLLATERAL_SHOCK;
        // REFLEXIVE_COLLAPSE — multiplier is irrelevant since issuance is halted,
        // but return max to prevent any edge case where a stale quote leaks through.
        return type(uint256).max;
    }

    // ─────────────────────────────────────────
    // Regime-Specific Controls
    // ─────────────────────────────────────────

    function _applyRegimeControls(
        address asset,
        AssetState storage state,
        Regime regime
    ) internal {
        if (regime == Regime.REFLEXIVE_COLLAPSE) {
            // HALT all new issuance immediately
            if (!state.issuanceHalted) {
                state.issuanceHalted = true;
                emit IssuanceHalted(asset);
            }
            state.maxNewCoverage = 0;
        } else if (regime == Regime.COLLATERAL_SHOCK) {
            // Cap new coverage — don't allow unlimited exposure growth
            // during a shock. Existing policies remain valid.
            // Owner sets the cap externally; here we just enforce the halt-lift.
            if (state.issuanceHalted) {
                state.issuanceHalted = false;
                emit IssuanceResumed(asset);
            }
        } else {
            // Lower regimes: lift issuance halt, remove coverage cap
            if (state.issuanceHalted) {
                state.issuanceHalted = false;
                emit IssuanceResumed(asset);
            }
            state.maxNewCoverage = 0; // 0 = unlimited
        }
    }

    // ─────────────────────────────────────────
    // Escalation Derivation
    // ─────────────────────────────────────────
    //
    // Maps (regime, confidence) → escalation level.
    // Policy issuance is blocked at ESCALATING and CRITICAL.

    function _deriveEscalation(
        Regime regime,
        uint256 confidence
    ) internal pure returns (EscalationLevel) {
        if (regime == Regime.REFLEXIVE_COLLAPSE) {
            return EscalationLevel.CRITICAL;
        }
        if (regime == Regime.COLLATERAL_SHOCK) {
            return confidence > 7000
                ? EscalationLevel.ESCALATING
                : EscalationLevel.ELEVATED;
        }
        if (regime == Regime.CONTAINED_STRESS) {
            return confidence > 8000
                ? EscalationLevel.ESCALATING
                : EscalationLevel.ELEVATED;
        }
        if (regime == Regime.LIQUIDITY_DISLOCATION) {
            return EscalationLevel.ELEVATED;
        }
        // AMBIGUOUS
        return EscalationLevel.NORMAL;
    }

    // ─────────────────────────────────────────
    // External Read Functions
    // ─────────────────────────────────────────

    function getCurrentRegime(address asset)
        external view returns (uint8 regime, uint256 confidence)
    {
        AssetState storage state = assetStates[asset];
        return (uint8(state.regime), state.confidence);
    }

    function isPolicyIssuanceAllowed(address asset) external view returns (bool) {
        AssetState storage state = assetStates[asset];

        // Blocked during ESCALATING or CRITICAL
        if (state.escalation >= EscalationLevel.ESCALATING) {
            return false;
        }

        // Blocked if issuance explicitly halted (reflexive_collapse)
        if (state.issuanceHalted) {
            return false;
        }

        return true;
    }

    function getPremiumMultiplier(address asset) external view returns (uint256) {
        return assetStates[asset].premiumMultiplierBps;
    }

    function getEscalationLevel(address asset) external view returns (uint8) {
        return uint8(assetStates[asset].escalation);
    }

    // ─────────────────────────────────────────
    // LP Withdrawal Lockup (72h)
    // ─────────────────────────────────────────
    //
    // After ANY regime transition, LP withdrawals are locked for 72 hours.
    // This prevents LPs from front-running a deepening crisis by pulling
    // capital after the signal fires but before claims materialize.
    //
    // The HazardCurveEngine or vault contract calls this to check.

    function isWithdrawalAllowed(address asset) external view returns (bool) {
        uint256 lastTransition = assetStates[asset].lastRegimeTransition;

        // No transition ever recorded — allow
        if (lastTransition == 0) {
            return true;
        }

        return block.timestamp > lastTransition + LOCKUP_PERIOD;
    }

    function timeUntilWithdrawalUnlock(address asset) external view returns (uint256) {
        uint256 lastTransition = assetStates[asset].lastRegimeTransition;

        if (lastTransition == 0) {
            return 0;
        }

        uint256 unlockTime = lastTransition + LOCKUP_PERIOD;
        if (block.timestamp >= unlockTime) {
            return 0;
        }

        return unlockTime - block.timestamp;
    }

    // ─────────────────────────────────────────
    // Coverage Cap Management
    // ─────────────────────────────────────────

    function setCoverageCap(address asset, uint256 maxCoverage) external onlyOwner {
        assetStates[asset].maxNewCoverage = maxCoverage;
        emit CoverageCapSet(asset, maxCoverage);
    }

    function getCoverageCap(address asset) external view returns (uint256) {
        return assetStates[asset].maxNewCoverage;
    }

    // ─────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────

    function setSignalRelayer(address _relayer) external onlyOwner {
        require(_relayer != address(0), "OracleAdapter: zero relayer");
        signalRelayer = _relayer;
    }

    function setHazardEngine(address _engine) external onlyOwner {
        require(_engine != address(0), "OracleAdapter: zero engine");
        hazardEngine = IHazardCurveEngine(_engine);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "OracleAdapter: zero owner");
        owner = newOwner;
    }
}
