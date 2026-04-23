// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ContagionRegistry} from "./ContagionRegistry.sol";

/**
 * @title BackingRatioOracle
 * @notice Monitors backing ratio R for wrapped assets.
 *
 * R = (total backing assets held by bridge/protocol) / (total wrapped tokens in circulation)
 *
 * R = 1.0 (10000 bps): fully backed
 * R < 1.0: underbacked — breach territory
 * R = 0: total loss
 *
 * The keeper pushes R values from off-chain monitoring of bridge reserves.
 * When R drops below the breach threshold, ContagionTrigger fires atomically.
 *
 * Design: no independent oracle attack surface. R is pushed by the same
 * keeper infrastructure that monitors bridge health. The trigger reads R
 * and fires in the same transaction — no timing arbitrage between
 * "oracle knows" and "trigger fires."
 */
contract BackingRatioOracle {

    // -- Structs -----

    struct RatioSnapshot {
        uint32  timestamp;      // block.timestamp of observation
        uint16  ratioBps;       // backing ratio in bps (10000 = 1.0 = fully backed)
        uint16  prevRatioBps;   // previous ratio for trend detection
        uint256 totalBacking;   // total backing assets (in asset decimals)
        uint256 totalSupply;    // total wrapped token supply
        bool    breached;       // true if ratioBps < breachThresholdBps
    }

    // -- Events -----

    event RatioUpdated(
        bytes32 indexed assetId,
        uint16  ratioBps,
        uint256 totalBacking,
        uint256 totalSupply,
        bool    breached
    );

    event BreachThresholdSet(bytes32 indexed assetId, uint16 thresholdBps);
    event BreachDetected(bytes32 indexed assetId, uint16 ratioBps, uint16 thresholdBps);

    // -- State -----

    address public owner;
    address public keeper;
    ContagionRegistry public registry;

    // assetId => latest ratio snapshot
    mapping(bytes32 => RatioSnapshot) public snapshots;

    // assetId => breach threshold in bps (default: 9500 = 95%)
    mapping(bytes32 => uint16) public breachThresholds;

    uint16 public constant DEFAULT_BREACH_THRESHOLD = 9500; // 95%

    // -- Modifiers -----

    modifier onlyOwner() {
        require(msg.sender == owner, "BackingRatioOracle: not owner");
        _;
    }

    modifier onlyKeeper() {
        require(msg.sender == keeper || msg.sender == owner, "BackingRatioOracle: not keeper");
        _;
    }

    // -- Constructor -----

    constructor(address _keeper, address _registry) {
        require(_keeper != address(0), "zero keeper");
        require(_registry != address(0), "zero registry");
        owner = msg.sender;
        keeper = _keeper;
        registry = ContagionRegistry(_registry);
    }

    // =========================================================================
    // Core: Push Backing Ratio
    // =========================================================================
    //
    // The keeper monitors bridge/protocol reserves off-chain and pushes R.
    // This is the only entry point for ratio data — no Chainlink dependency,
    // no secondary oracle. The same keeper that detects the breach pushes R
    // and the ContagionTrigger reads it in the same block.

    function pushRatio(
        bytes32 assetId,
        uint256 totalBacking,
        uint256 totalSupply
    ) external onlyKeeper returns (bool breached) {
        ContagionRegistry.WrappedAsset memory asset = registry.getAsset(assetId);
        require(asset.token != address(0), "asset not registered");
        require(asset.active, "asset not active");
        require(totalSupply > 0, "zero supply");

        // Calculate R in bps: (backing / supply) * 10000
        uint256 rBps = (totalBacking * 10000) / totalSupply;
        uint16 ratioBps = rBps > type(uint16).max ? type(uint16).max : uint16(rBps);

        RatioSnapshot storage snap = snapshots[assetId];
        uint16 prevRatio = snap.ratioBps;

        uint16 threshold = breachThresholds[assetId];
        if (threshold == 0) threshold = DEFAULT_BREACH_THRESHOLD;

        breached = ratioBps < threshold;

        snap.timestamp = uint32(block.timestamp);
        snap.ratioBps = ratioBps;
        snap.prevRatioBps = prevRatio;
        snap.totalBacking = totalBacking;
        snap.totalSupply = totalSupply;
        snap.breached = breached;

        emit RatioUpdated(assetId, ratioBps, totalBacking, totalSupply, breached);

        if (breached) {
            emit BreachDetected(assetId, ratioBps, threshold);
        }
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    function getCurrentRatio(bytes32 assetId) external view returns (
        uint16 ratioBps,
        bool   breached,
        uint32 timestamp
    ) {
        RatioSnapshot memory snap = snapshots[assetId];
        uint16 threshold = breachThresholds[assetId];
        if (threshold == 0) threshold = DEFAULT_BREACH_THRESHOLD;

        return (snap.ratioBps, snap.ratioBps < threshold, snap.timestamp);
    }

    function getSnapshot(bytes32 assetId) external view returns (RatioSnapshot memory) {
        return snapshots[assetId];
    }

    /**
     * @notice Dilution depth at breach: (1 - R_breach).
     *         Used directly in payout calculation.
     * @return dilutionBps Dilution in basis points (1800 = 18% dilution when R = 82%)
     */
    function getDilutionDepth(bytes32 assetId) external view returns (uint16 dilutionBps) {
        RatioSnapshot memory snap = snapshots[assetId];
        if (snap.ratioBps >= 10000) return 0;
        return 10000 - snap.ratioBps;
    }

    function isBreached(bytes32 assetId) external view returns (bool) {
        return snapshots[assetId].breached;
    }

    // =========================================================================
    // Admin
    // =========================================================================

    function setBreachThreshold(bytes32 assetId, uint16 thresholdBps) external onlyOwner {
        require(thresholdBps > 0 && thresholdBps <= 10000, "invalid threshold");
        breachThresholds[assetId] = thresholdBps;
        emit BreachThresholdSet(assetId, thresholdBps);
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
