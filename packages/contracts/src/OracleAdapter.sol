// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IDsrptHazardEngine} from "./interfaces/IDsrptHazardEngine.sol";

/**
 * @title OracleAdapter
 * @notice Bridges the off-chain signal engine to on-chain pricing via DsrptHazardEngine.
 *
 * The core vulnerability: any latency between signal detection (Python
 * classifier_v2.py) and premium repricing (DsrptHazardEngine) lets
 * sophisticated actors buy coverage at stale prices. This contract
 * eliminates that gap by atomically updating regime state, oracle state,
 * and triggering a regime transition on the engine — all in one transaction.
 *
 * Signal engine regime taxonomy (5 levels from classifier_v2.py):
 *   0 AMBIGUOUS            -- base pricing (1.00x)        -> Engine: Calm
 *   1 CONTAINED_STRESS     -- mild contagion (1.25x)      -> Engine: Volatile
 *   2 LIQUIDITY_DISLOCATION -- execution risk (1.10x)     -> Engine: Volatile
 *   3 COLLATERAL_SHOCK     -- reserve impairment (1.50x)  -> Engine: Crisis
 *   4 REFLEXIVE_COLLAPSE   -- halt issuance               -> Engine: Crisis
 *
 * DsrptHazardEngine regime transitions:
 *   - Upgrades (Calm->Volatile, Volatile->Crisis) are IMMEDIATE
 *   - Downgrades have timelocks (Crisis->Volatile: 7d, Volatile->Calm: 3d)
 *   - This is the right behavior: risk increases take effect instantly,
 *     de-escalation is conservative
 *
 * Required roles on DsrptHazardEngine:
 *   - riskOracle: to call proposeRegimeChange() (immediate for upgrades)
 *   - keeper: to call pushOracleState() with signal-derived market state
 *
 * Setup:
 *   hazardEngine.setRiskOracle(address(oracleAdapter));
 *   hazardEngine.setKeeper(address(oracleAdapter));
 */
contract OracleAdapter {

    // -- Signal engine regime (5-level, from classifier_v2.py) -----

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

    event EngineRegimeSynced(
        bytes32 indexed perilId,
        IDsrptHazardEngine.RegimeKind engineRegime
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

    // -- State -----

    address public owner;
    address public signalRelayer;
    IDsrptHazardEngine public hazardEngine;

    uint256 public constant LOCKUP_PERIOD = 72 hours;

    // Premium multipliers in basis points (10000 = 1.00x)
    uint256 public constant MULT_AMBIGUOUS           = 10_000; // 1.00x
    uint256 public constant MULT_CONTAINED_STRESS    = 12_500; // 1.25x
    uint256 public constant MULT_LIQUIDITY_DISLOC    = 11_000; // 1.10x
    uint256 public constant MULT_COLLATERAL_SHOCK    = 15_000; // 1.50x

    // Shock flag values for pushOracleState
    uint8 public constant SHOCK_NORMAL  = 0;
    uint8 public constant SHOCK_WARNING = 1;
    uint8 public constant SHOCK_ACTIVE  = 2;

    mapping(address => AssetState) public assetStates;
    mapping(address => bytes32)    public assetPerilIds;

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
        hazardEngine  = IDsrptHazardEngine(_hazardEngine);
    }

    // =========================================================================
    // Setup: register asset -> perilId mapping
    // =========================================================================

    function registerAsset(address asset, bytes32 perilId) external onlyOwner {
        require(perilId != bytes32(0), "OracleAdapter: zero perilId");
        assetPerilIds[asset] = perilId;
    }

    // =========================================================================
    // Core: Atomic Regime Update
    // =========================================================================
    //
    // Critical path. The relayer calls updateRegime() and the contract:
    //   1. Records new regime + confidence
    //   2. Computes premium multiplier and escalation
    //   3. Maps 5-level signal regime to 3-level engine regime
    //   4. Calls proposeRegimeChange() on DsrptHazardEngine (immediate for upgrades)
    //   5. Pushes oracle state with signal-derived shock flag + peg deviation
    //   6. Applies issuance gates and 72h LP lockup
    //
    // Zero latency: signal -> pricing update in one atomic transaction.
    // No block gap. No mempool exposure of the signal before repricing.

    function updateRegime(
        address asset,
        uint8   regimeId,
        uint256 confidence,  // 0-10000
        uint16  pegDevBps,   // current peg deviation from signal engine
        uint16  volBps       // realized volatility from signal engine
    ) external onlyRelayer {
        require(regimeId <= uint8(Regime.REFLEXIVE_COLLAPSE), "OracleAdapter: invalid regime");
        require(confidence <= 10_000, "OracleAdapter: confidence out of range");

        bytes32 perilId = assetPerilIds[asset];
        require(perilId != bytes32(0), "OracleAdapter: asset not registered");

        Regime newRegime = Regime(regimeId);
        AssetState storage state = assetStates[asset];

        Regime prevRegime = state.regime;
        bool regimeChanged = (newRegime != prevRegime) || (state.lastUpdateBlock == 0);

        // 1. Update local regime state
        state.previousRegime  = prevRegime;
        state.regime          = newRegime;
        state.confidence      = confidence;
        state.lastUpdateBlock = block.number;

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

        // 6. ATOMIC: sync DsrptHazardEngine — regime + oracle state in same tx
        _syncEngine(perilId, newRegime, regimeChanged, pegDevBps, volBps);

        // 7. Emit events
        emit RegimeUpdated(
            asset, newRegime, prevRegime, confidence, multiplier, block.timestamp
        );

        if (state.escalation != prevEscalation) {
            emit EscalationChanged(asset, state.escalation, prevEscalation);
        }
    }

    // =========================================================================
    // DsrptHazardEngine Sync
    // =========================================================================
    //
    // Two atomic operations in the same tx:
    //   1. proposeRegimeChange() — switches the hazard curve (immediate for upgrades)
    //   2. pushOracleState() — updates market multiplier inputs
    //
    // Together these ensure the premium calculation reflects the new regime
    // before any new policy can be written.

    function _syncEngine(
        bytes32 perilId,
        Regime  regime,
        bool    regimeChanged,
        uint16  pegDevBps,
        uint16  volBps
    ) internal {
        // Map 5-level signal regime to 3-level engine regime
        IDsrptHazardEngine.RegimeKind engineRegime = _mapToEngineRegime(regime);

        // Only propose regime change if the ENGINE regime actually changed
        if (regimeChanged) {
            IDsrptHazardEngine.RegimeKind currentEngineRegime = hazardEngine.getCurrentRegime(perilId);

            if (engineRegime != currentEngineRegime) {
                // proposeRegimeChange(): upgrades are immediate, downgrades timelocked
                hazardEngine.proposeRegimeChange(perilId, engineRegime);

                emit EngineRegimeSynced(perilId, engineRegime);
            }
        }

        // Push oracle state with signal-derived values.
        // The shock flag maps from regime severity:
        //   AMBIGUOUS/CONTAINED_STRESS  -> NORMAL (0)
        //   LIQUIDITY_DISLOCATION       -> WARNING (1)
        //   COLLATERAL_SHOCK            -> SHOCK (2)
        //   REFLEXIVE_COLLAPSE          -> SHOCK (2)
        uint8 shockFlag = _shockFlag(regime);

        hazardEngine.pushOracleState(
            perilId,
            IDsrptHazardEngine.OracleState({
                updatedAt:       uint32(block.timestamp),
                pegDevBps:       pegDevBps,
                volBps:          volBps,
                disagreementBps: 0, // not available from signal engine
                shockFlag:       shockFlag
            })
        );
    }

    // =========================================================================
    // Regime Mapping: 5-level signal -> 3-level engine
    // =========================================================================
    //
    // classifier_v2.py (5 regimes)     DsrptHazardEngine (3 regimes)
    // ─────────────────────────────    ─────────────────────────────
    // AMBIGUOUS                    ->  Calm
    // CONTAINED_STRESS             ->  Volatile
    // LIQUIDITY_DISLOCATION        ->  Volatile
    // COLLATERAL_SHOCK             ->  Crisis
    // REFLEXIVE_COLLAPSE           ->  Crisis

    function _mapToEngineRegime(Regime regime)
        internal pure returns (IDsrptHazardEngine.RegimeKind)
    {
        if (regime == Regime.AMBIGUOUS) {
            return IDsrptHazardEngine.RegimeKind.Calm;
        }
        if (regime == Regime.CONTAINED_STRESS || regime == Regime.LIQUIDITY_DISLOCATION) {
            return IDsrptHazardEngine.RegimeKind.Volatile;
        }
        // COLLATERAL_SHOCK and REFLEXIVE_COLLAPSE
        return IDsrptHazardEngine.RegimeKind.Crisis;
    }

    function _shockFlag(Regime regime) internal pure returns (uint8) {
        if (regime <= Regime.CONTAINED_STRESS) return SHOCK_NORMAL;
        if (regime == Regime.LIQUIDITY_DISLOCATION) return SHOCK_WARNING;
        return SHOCK_ACTIVE; // COLLATERAL_SHOCK, REFLEXIVE_COLLAPSE
    }

    // =========================================================================
    // Premium Multiplier Logic
    // =========================================================================

    function _premiumMultiplier(Regime regime) internal pure returns (uint256) {
        if (regime == Regime.AMBIGUOUS)             return MULT_AMBIGUOUS;
        if (regime == Regime.CONTAINED_STRESS)      return MULT_CONTAINED_STRESS;
        if (regime == Regime.LIQUIDITY_DISLOCATION) return MULT_LIQUIDITY_DISLOC;
        if (regime == Regime.COLLATERAL_SHOCK)      return MULT_COLLATERAL_SHOCK;
        // REFLEXIVE_COLLAPSE — issuance halted; return max as poison value
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
            if (state.issuanceHalted) {
                state.issuanceHalted = false;
                emit IssuanceResumed(asset);
            }
            // Coverage cap set externally via setCoverageCap()
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
     * @notice PolicyManager / DsrptPolicyManager calls this before writing a new policy.
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
        hazardEngine = IDsrptHazardEngine(_engine);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "OracleAdapter: zero owner");
        owner = newOwner;
    }
}
