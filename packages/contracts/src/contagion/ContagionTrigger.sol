// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ContagionRegistry} from "./ContagionRegistry.sol";
import {BackingRatioOracle} from "./BackingRatioOracle.sol";

/**
 * @title ContagionTrigger
 * @notice Atomic cascade trigger: when a backing ratio breach fires on a wrapped
 *         asset, every contagion policy referencing that asset auto-triggers in
 *         the same block.
 *
 * Three advantages of linked triggers:
 *   1. No independent oracle surface for attackers
 *   2. No timing arbitrage between primary and contagion
 *   3. Settlement is a single on-chain event, not a governance process
 *
 * Flow:
 *   keeper calls BackingRatioOracle.pushRatio() → breach detected
 *   keeper calls ContagionTrigger.triggerCascade() in the SAME transaction
 *   → ContagionTrigger reads R_breach from BackingRatioOracle
 *   → fires BreachCascade event with dilution depth
 *   → ContagionPolicyManager reads this to settle all affected policies
 *
 * The trigger is stateless — it reads from BackingRatioOracle and emits
 * events. Settlement happens in ContagionPolicyManager.
 */
contract ContagionTrigger {

    // -- Structs -----

    struct BreachEvent {
        bytes32 assetId;
        uint32  timestamp;        // block.timestamp of breach
        uint256 blockNumber;      // block.number of breach
        uint16  ratioBps;         // R at breach (e.g., 8200 = 82%)
        uint16  dilutionBps;      // 1 - R (e.g., 1800 = 18%)
        uint256 totalBacking;
        uint256 totalSupply;
        uint8   affectedMarkets;  // number of active lending markets affected
    }

    // -- Events -----

    event BreachCascade(
        bytes32 indexed assetId,
        uint16  ratioBps,
        uint16  dilutionBps,
        uint256 blockNumber,
        uint8   affectedMarkets
    );

    event MarketAffected(
        bytes32 indexed assetId,
        address indexed market,
        uint16  ltvBps,
        uint256 supplyCap,
        uint256 estimatedPayout  // supplyCap × ltvBps × dilutionBps / 10000^2
    );

    // -- State -----

    address public owner;
    address public keeper;
    ContagionRegistry public registry;
    BackingRatioOracle public oracle;

    // assetId => latest breach event
    mapping(bytes32 => BreachEvent) public breachEvents;

    // assetId => breach count
    mapping(bytes32 => uint256) public breachCount;

    // Address authorized to settle policies (ContagionPolicyManager)
    address public policyManager;

    // -- Modifiers -----

    modifier onlyOwner() {
        require(msg.sender == owner, "ContagionTrigger: not owner");
        _;
    }

    modifier onlyKeeper() {
        require(msg.sender == keeper || msg.sender == owner, "ContagionTrigger: not keeper");
        _;
    }

    // -- Constructor -----

    constructor(address _keeper, address _registry, address _oracle) {
        require(_keeper != address(0) && _registry != address(0) && _oracle != address(0), "zero address");
        owner = msg.sender;
        keeper = _keeper;
        registry = ContagionRegistry(_registry);
        oracle = BackingRatioOracle(_oracle);
    }

    // =========================================================================
    // Core: Atomic Cascade Trigger
    // =========================================================================
    //
    // Called by the keeper in the SAME transaction as BackingRatioOracle.pushRatio().
    // Reads the breach state and cascades to all referencing lending markets.

    function triggerCascade(bytes32 assetId) external onlyKeeper returns (BreachEvent memory) {
        return _executeCascade(assetId);
    }

    /**
     * @notice Combined operation: push ratio AND trigger cascade if breached.
     *         Single transaction, zero latency between detection and trigger.
     */
    function pushAndTrigger(
        bytes32 assetId,
        uint256 totalBacking,
        uint256 totalSupply
    ) external onlyKeeper returns (bool triggered) {
        bool breached = oracle.pushRatio(assetId, totalBacking, totalSupply);

        if (breached) {
            _executeCascade(assetId);
            triggered = true;
        }
    }

    function _executeCascade(bytes32 assetId) internal returns (BreachEvent memory) {
        require(oracle.isBreached(assetId), "ContagionTrigger: no breach");

        BackingRatioOracle.RatioSnapshot memory snap = oracle.getSnapshot(assetId);
        uint16 dilution = 10000 - snap.ratioBps;

        (ContagionRegistry.LendingMarketListing[] memory markets, uint256 count) =
            registry.getActiveListings(assetId);

        BreachEvent memory evt = BreachEvent({
            assetId:         assetId,
            timestamp:       uint32(block.timestamp),
            blockNumber:     block.number,
            ratioBps:        snap.ratioBps,
            dilutionBps:     dilution,
            totalBacking:    snap.totalBacking,
            totalSupply:     snap.totalSupply,
            affectedMarkets: uint8(count)
        });

        breachEvents[assetId] = evt;
        breachCount[assetId]++;

        emit BreachCascade(assetId, snap.ratioBps, dilution, block.number, uint8(count));

        for (uint256 i = 0; i < count; i++) {
            ContagionRegistry.LendingMarketListing memory m = markets[i];
            uint256 estimatedPayout = (m.supplyCap * m.ltvBps * dilution) / (10000 * 10000);

            emit MarketAffected(assetId, m.market, m.ltvBps, m.supplyCap, estimatedPayout);
        }

        return evt;
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    function getBreachEvent(bytes32 assetId) external view returns (BreachEvent memory) {
        return breachEvents[assetId];
    }

    function isTriggered(bytes32 assetId) external view returns (bool) {
        return breachEvents[assetId].blockNumber > 0;
    }

    /**
     * @notice Calculate total estimated payout across all affected markets.
     *         Used by ContagionPolicyManager for settlement.
     */
    function estimateTotalPayout(bytes32 assetId) external view returns (uint256 totalPayout) {
        BreachEvent memory evt = breachEvents[assetId];
        if (evt.blockNumber == 0) return 0;

        (ContagionRegistry.LendingMarketListing[] memory markets, uint256 count) =
            registry.getActiveListings(assetId);

        for (uint256 i = 0; i < count; i++) {
            totalPayout += (markets[i].supplyCap * markets[i].ltvBps * evt.dilutionBps) / (10000 * 10000);
        }
    }

    // =========================================================================
    // Admin
    // =========================================================================

    function setPolicyManager(address _pm) external onlyOwner {
        policyManager = _pm;
    }

    function setKeeper(address _keeper) external onlyOwner {
        require(_keeper != address(0), "zero keeper");
        keeper = _keeper;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        owner = newOwner;
    }
}
