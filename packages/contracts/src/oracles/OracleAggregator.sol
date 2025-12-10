// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";
import {IDsrptOracleAdapter} from "../interfaces/IDsrptOracleAdapter.sol";
import {IDsrptHazardEngine} from "../interfaces/IDsrptHazardEngine.sol";

/**
 * @title OracleAggregator
 * @notice Aggregates multi-source price feeds and computes oracle state
 * @dev Keeper-operated module that pushes state to HazardEngine
 *
 * Features:
 * - Multi-feed aggregation with weighted median
 * - Rolling volatility calculation
 * - Cross-venue disagreement detection
 * - Shock detection with severity levels
 */
contract OracleAggregator is IDsrptOracleAdapter {
    // ============ CONSTANTS ============

    /// @dev Precision for price calculations (1e18)
    uint256 private constant PRECISION = 1e18;

    /// @dev Basis points precision
    uint256 private constant BPS = 10_000;

    /// @dev Maximum number of feeds per peril
    uint8 private constant MAX_FEEDS = 5;

    /// @dev Maximum snapshots to store (for volatility)
    uint16 private constant MAX_SNAPSHOTS = 288; // 24 hours at 5-min intervals

    /// @dev Peg price for stablecoins (1.0 scaled to 1e18)
    uint256 private constant PEG_PRICE = 1e18;

    // ============ STORAGE ============

    /// @notice Hazard engine for state updates
    IDsrptHazardEngine public hazardEngine;

    /// @notice Contract owner
    address public owner;

    /// @notice Keeper address
    address public keeper;

    /// @notice Price feeds per peril
    mapping(bytes32 => PriceFeed[]) private _feeds;

    /// @notice Latest snapshot per peril
    mapping(bytes32 => PriceSnapshot) private _latestSnapshots;

    /// @notice Historical snapshots per peril (circular buffer)
    mapping(bytes32 => PriceSnapshot[]) private _historicalSnapshots;

    /// @notice Snapshot buffer index per peril
    mapping(bytes32 => uint256) private _snapshotIndex;

    /// @notice Volatility config per peril
    mapping(bytes32 => VolatilityConfig) private _volConfigs;

    /// @notice Last shock timestamp per peril (for cooldown)
    mapping(bytes32 => uint32) private _lastShockTime;

    /// @notice Staleness threshold per peril (in seconds, default 86400 = 24 hours)
    mapping(bytes32 => uint256) private _stalenessThreshold;

    // ============ MODIFIERS ============

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyKeeper() {
        require(msg.sender == keeper || msg.sender == owner, "Not keeper");
        _;
    }

    // ============ CONSTRUCTOR ============

    constructor(address _keeper) {
        owner = msg.sender;
        keeper = _keeper;
    }

    // ============ VIEW FUNCTIONS ============

    /// @inheritdoc IDsrptOracleAdapter
    function getActiveFeeds(bytes32 perilId)
        external
        view
        override
        returns (PriceFeed[] memory feeds)
    {
        PriceFeed[] storage allFeeds = _feeds[perilId];
        uint256 activeCount = 0;

        // Count active feeds
        for (uint256 i = 0; i < allFeeds.length; i++) {
            if (allFeeds[i].active) activeCount++;
        }

        // Build active array
        feeds = new PriceFeed[](activeCount);
        uint256 j = 0;
        for (uint256 i = 0; i < allFeeds.length; i++) {
            if (allFeeds[i].active) {
                feeds[j++] = allFeeds[i];
            }
        }
    }

    /// @inheritdoc IDsrptOracleAdapter
    function getLatestSnapshot(bytes32 perilId)
        external
        view
        override
        returns (PriceSnapshot memory snapshot)
    {
        return _latestSnapshots[perilId];
    }

    /// @inheritdoc IDsrptOracleAdapter
    function getHistoricalSnapshots(bytes32 perilId, uint256 count)
        external
        view
        override
        returns (PriceSnapshot[] memory snapshots)
    {
        PriceSnapshot[] storage history = _historicalSnapshots[perilId];
        uint256 available = history.length;
        uint256 toReturn = count > available ? available : count;

        snapshots = new PriceSnapshot[](toReturn);

        uint256 currentIdx = _snapshotIndex[perilId];
        for (uint256 i = 0; i < toReturn; i++) {
            // Go backwards from current index
            uint256 idx = currentIdx >= i + 1 ? currentIdx - i - 1 : available - (i + 1 - currentIdx);
            if (idx < available) {
                snapshots[i] = history[idx];
            }
        }
    }

    /// @inheritdoc IDsrptOracleAdapter
    function getVolatilityConfig(bytes32 perilId)
        external
        view
        override
        returns (VolatilityConfig memory config)
    {
        return _volConfigs[perilId];
    }

    /// @inheritdoc IDsrptOracleAdapter
    function computeOracleState(bytes32 perilId)
        external
        view
        override
        returns (IDsrptHazardEngine.OracleState memory state)
    {
        PriceSnapshot memory snapshot = _latestSnapshots[perilId];

        // Peg deviation
        uint256 pegDeviation = snapshot.medianPrice > PEG_PRICE
            ? snapshot.medianPrice - PEG_PRICE
            : PEG_PRICE - snapshot.medianPrice;
        state.pegDevBps = uint16((pegDeviation * BPS) / PEG_PRICE);

        // Volatility
        state.volBps = uint16(_calculateVolatility(perilId));

        // Disagreement
        if (snapshot.maxPrice > 0) {
            uint256 spread = snapshot.maxPrice - snapshot.minPrice;
            state.disagreementBps = uint16((spread * BPS) / snapshot.medianPrice);
        }

        // Shock flag
        state.shockFlag = _detectShock(perilId, snapshot);

        state.updatedAt = snapshot.timestamp;
    }

    // ============ KEEPER FUNCTIONS ============

    /// @inheritdoc IDsrptOracleAdapter
    function recordSnapshot(bytes32 perilId) external override onlyKeeper {
        PriceFeed[] storage feeds = _feeds[perilId];

        uint8 activeCount = 0;
        uint256[] memory prices = new uint256[](MAX_FEEDS);

        // Collect prices from all active feeds
        for (uint256 i = 0; i < feeds.length; i++) {
            if (!feeds[i].active) continue;

            try AggregatorV3Interface(feeds[i].feedAddress).latestRoundData() returns (
                uint80,
                int256 answer,
                uint256,
                uint256 updatedAt,
                uint80
            ) {
                // Check staleness (use configured threshold, default to 24 hours if not set)
                uint256 threshold = _stalenessThreshold[perilId];
                if (threshold == 0) threshold = 86400; // Default 24 hours
                if (block.timestamp - updatedAt > threshold) {
                    continue; // Skip stale feeds
                }

                // Normalize to 1e18
                uint256 normalized = _normalizePrice(uint256(answer), feeds[i].decimals);
                prices[activeCount++] = normalized;
            } catch {
                // Feed failed, skip
                continue;
            }
        }

        if (activeCount < 1) {
            revert InsufficientFeeds(perilId, activeCount, 1);
        }

        // Calculate median (simple for small arrays)
        uint256 medianPrice = _calculateMedian(prices, activeCount);
        uint256 minPrice = _findMin(prices, activeCount);
        uint256 maxPrice = _findMax(prices, activeCount);

        PriceSnapshot memory snapshot = PriceSnapshot({
            timestamp: uint32(block.timestamp),
            medianPrice: medianPrice,
            minPrice: minPrice,
            maxPrice: maxPrice,
            feedCount: activeCount
        });

        // Store snapshot
        _latestSnapshots[perilId] = snapshot;

        // Add to history (circular buffer)
        PriceSnapshot[] storage history = _historicalSnapshots[perilId];
        uint256 idx = _snapshotIndex[perilId];

        if (history.length < MAX_SNAPSHOTS) {
            history.push(snapshot);
        } else {
            history[idx % MAX_SNAPSHOTS] = snapshot;
        }
        _snapshotIndex[perilId] = idx + 1;

        uint256 disagreementBps = maxPrice > 0 ? ((maxPrice - minPrice) * BPS) / medianPrice : 0;

        emit PriceSnapshotRecorded(perilId, uint32(block.timestamp), medianPrice, disagreementBps);
    }

    /// @inheritdoc IDsrptOracleAdapter
    function updateOracleState(bytes32 perilId) external override onlyKeeper {
        // First record a fresh snapshot
        this.recordSnapshot(perilId);

        // Compute state
        IDsrptHazardEngine.OracleState memory state = this.computeOracleState(perilId);

        // Push to hazard engine
        hazardEngine.pushOracleState(perilId, state);

        emit OracleStateComputed(
            perilId,
            state.pegDevBps,
            state.volBps,
            state.disagreementBps,
            state.shockFlag
        );

        // Emit shock event if detected
        if (state.shockFlag > 0) {
            string memory reason = state.shockFlag == 2 ? "Severe disagreement" : "Rapid price move";
            emit ShockDetected(perilId, state.shockFlag, reason);
            _lastShockTime[perilId] = uint32(block.timestamp);
        }
    }

    /// @inheritdoc IDsrptOracleAdapter
    function batchUpdateOracleState(bytes32[] calldata perilIds) external override onlyKeeper {
        for (uint256 i = 0; i < perilIds.length; i++) {
            this.updateOracleState(perilIds[i]);
        }
    }

    // ============ GOVERNANCE FUNCTIONS ============

    /// @inheritdoc IDsrptOracleAdapter
    function addFeed(
        bytes32 perilId,
        address feedAddress,
        uint8 decimals,
        uint16 weight
    ) external override onlyOwner {
        if (weight > BPS) revert InvalidWeight(weight);

        PriceFeed[] storage feeds = _feeds[perilId];

        // Check not already exists
        for (uint256 i = 0; i < feeds.length; i++) {
            if (feeds[i].feedAddress == feedAddress) {
                revert FeedAlreadyExists(perilId, feedAddress);
            }
        }

        require(feeds.length < MAX_FEEDS, "Max feeds reached");

        feeds.push(PriceFeed({
            feedAddress: feedAddress,
            decimals: decimals,
            active: true,
            weight: weight
        }));

        emit FeedAdded(perilId, feedAddress, decimals, weight);
    }

    /// @inheritdoc IDsrptOracleAdapter
    function removeFeed(
        bytes32 perilId,
        address feedAddress
    ) external override onlyOwner {
        PriceFeed[] storage feeds = _feeds[perilId];

        for (uint256 i = 0; i < feeds.length; i++) {
            if (feeds[i].feedAddress == feedAddress) {
                feeds[i].active = false;
                emit FeedRemoved(perilId, feedAddress);
                return;
            }
        }

        revert FeedNotFound(perilId, feedAddress);
    }

    /// @inheritdoc IDsrptOracleAdapter
    function updateFeedWeight(
        bytes32 perilId,
        address feedAddress,
        uint16 newWeight
    ) external override onlyOwner {
        if (newWeight > BPS) revert InvalidWeight(newWeight);

        PriceFeed[] storage feeds = _feeds[perilId];

        for (uint256 i = 0; i < feeds.length; i++) {
            if (feeds[i].feedAddress == feedAddress) {
                uint16 oldWeight = feeds[i].weight;
                feeds[i].weight = newWeight;
                emit FeedWeightUpdated(perilId, feedAddress, oldWeight, newWeight);
                return;
            }
        }

        revert FeedNotFound(perilId, feedAddress);
    }

    /// @inheritdoc IDsrptOracleAdapter
    function setVolatilityConfig(
        bytes32 perilId,
        VolatilityConfig calldata config
    ) external override onlyOwner {
        if (config.windowSize == 0 || config.sampleInterval == 0) {
            revert InvalidVolatilityConfig();
        }

        _volConfigs[perilId] = config;
    }

    /// @inheritdoc IDsrptOracleAdapter
    function setHazardEngine(address engine) external override onlyOwner {
        require(engine != address(0), "Zero address");
        hazardEngine = IDsrptHazardEngine(engine);
    }

    /**
     * @notice Set staleness threshold for a peril
     * @param perilId The peril identifier
     * @param threshold Staleness threshold in seconds (0 = use default 24 hours)
     */
    function setStalenessThreshold(bytes32 perilId, uint256 threshold) external onlyOwner {
        _stalenessThreshold[perilId] = threshold;
    }

    /**
     * @notice Get staleness threshold for a peril
     * @param perilId The peril identifier
     * @return threshold Staleness threshold in seconds (returns default if not set)
     */
    function getStalenessThreshold(bytes32 perilId) external view returns (uint256 threshold) {
        threshold = _stalenessThreshold[perilId];
        if (threshold == 0) threshold = 86400; // Default 24 hours
    }

    /**
     * @notice Set keeper address
     * @param _keeper New keeper address
     */
    function setKeeper(address _keeper) external onlyOwner {
        keeper = _keeper;
    }

    /**
     * @notice Transfer ownership
     * @param newOwner New owner address
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Normalize price to 1e18 precision
     */
    function _normalizePrice(uint256 price, uint8 decimals) internal pure returns (uint256) {
        if (decimals < 18) {
            return price * (10 ** (18 - decimals));
        } else if (decimals > 18) {
            return price / (10 ** (decimals - 18));
        }
        return price;
    }

    /**
     * @dev Calculate median of price array
     */
    function _calculateMedian(uint256[] memory prices, uint8 count) internal pure returns (uint256) {
        if (count == 0) return 0;
        if (count == 1) return prices[0];

        // Simple bubble sort for small arrays
        for (uint8 i = 0; i < count - 1; i++) {
            for (uint8 j = 0; j < count - i - 1; j++) {
                if (prices[j] > prices[j + 1]) {
                    (prices[j], prices[j + 1]) = (prices[j + 1], prices[j]);
                }
            }
        }

        if (count % 2 == 0) {
            return (prices[count / 2 - 1] + prices[count / 2]) / 2;
        } else {
            return prices[count / 2];
        }
    }

    /**
     * @dev Find minimum in price array
     */
    function _findMin(uint256[] memory prices, uint8 count) internal pure returns (uint256) {
        if (count == 0) return 0;
        uint256 min = prices[0];
        for (uint8 i = 1; i < count; i++) {
            if (prices[i] < min) min = prices[i];
        }
        return min;
    }

    /**
     * @dev Find maximum in price array
     */
    function _findMax(uint256[] memory prices, uint8 count) internal pure returns (uint256) {
        if (count == 0) return 0;
        uint256 max = prices[0];
        for (uint8 i = 1; i < count; i++) {
            if (prices[i] > max) max = prices[i];
        }
        return max;
    }

    /**
     * @dev Calculate rolling volatility from historical snapshots
     */
    function _calculateVolatility(bytes32 perilId) internal view returns (uint256 volBps) {
        VolatilityConfig storage config = _volConfigs[perilId];
        PriceSnapshot[] storage history = _historicalSnapshots[perilId];

        if (history.length < 2 || config.windowSize < 2) {
            return 0;
        }

        uint256 windowSize = config.windowSize > history.length ? history.length : config.windowSize;

        // Calculate returns and variance
        uint256 sumSquaredReturns = 0;
        uint256 currentIdx = _snapshotIndex[perilId];

        for (uint256 i = 1; i < windowSize; i++) {
            uint256 idx1 = (currentIdx + history.length - i) % history.length;
            uint256 idx2 = (currentIdx + history.length - i - 1) % history.length;

            uint256 price1 = history[idx1].medianPrice;
            uint256 price2 = history[idx2].medianPrice;

            if (price2 == 0) continue;

            // Log return approximation: (price1 - price2) / price2
            int256 returnBps;
            if (price1 >= price2) {
                returnBps = int256(((price1 - price2) * BPS) / price2);
            } else {
                returnBps = -int256(((price2 - price1) * BPS) / price2);
            }

            sumSquaredReturns += uint256(returnBps * returnBps);
        }

        // Variance = sum of squared returns / (n - 1)
        uint256 variance = sumSquaredReturns / (windowSize - 1);

        // Annualize: multiply by sqrt(periods per year)
        // For 5-min intervals: sqrt(365 * 24 * 12) ≈ 324
        // config.annualizationFactor1e18 should be ~324e18
        uint256 annualizedVariance = (variance * config.annualizationFactor1e18) / PRECISION;

        // Return std dev (sqrt of variance), approximated
        // sqrt(x) ≈ x / 2 for small x, but we need better approximation
        // Using Babylonian method for 3 iterations
        volBps = _sqrt(annualizedVariance);
    }

    /**
     * @dev Detect shock conditions
     */
    function _detectShock(bytes32 perilId, PriceSnapshot memory snapshot) internal view returns (uint8) {
        // Check cross-venue disagreement
        if (snapshot.maxPrice > 0 && snapshot.minPrice > 0) {
            uint256 spread = snapshot.maxPrice - snapshot.minPrice;
            uint256 spreadBps = (spread * BPS) / snapshot.medianPrice;

            if (spreadBps > 100) {
                return 2; // Severe disagreement (> 1%)
            }
        }

        // Check rapid price move (compare to previous snapshot)
        PriceSnapshot[] storage history = _historicalSnapshots[perilId];
        if (history.length > 0) {
            uint256 prevIdx = (_snapshotIndex[perilId] + history.length - 1) % history.length;
            PriceSnapshot storage prev = history[prevIdx];

            if (prev.medianPrice > 0) {
                uint256 move = snapshot.medianPrice > prev.medianPrice
                    ? snapshot.medianPrice - prev.medianPrice
                    : prev.medianPrice - snapshot.medianPrice;

                uint256 moveBps = (move * BPS) / prev.medianPrice;

                if (moveBps > 50) {
                    return 1; // Warning (> 0.5% move in one interval)
                }
            }
        }

        return 0; // Normal
    }

    /**
     * @dev Integer square root using Babylonian method
     */
    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;

        uint256 z = (x + 1) / 2;
        uint256 y = x;

        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }

        return y;
    }
}
