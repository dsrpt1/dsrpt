// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IDsrptHazardEngine} from "./IDsrptHazardEngine.sol";

/**
 * @title IDsrptOracleAdapter
 * @notice Aggregates multi-source price feeds and computes oracle state
 * @dev Keeper-operated module that pushes state to HazardEngine
 */
interface IDsrptOracleAdapter {

    // ============ STRUCTS ============

    /**
     * @notice Single price feed source
     * @param feedAddress Oracle contract address
     * @param decimals Price decimals (e.g., 8 for Chainlink)
     * @param active Whether feed is currently active
     * @param weight Relative weight in aggregation (0-10000)
     */
    struct PriceFeed {
        address feedAddress;
        uint8 decimals;
        bool active;
        uint16 weight;
    }

    /**
     * @notice Aggregated price snapshot
     * @param timestamp When snapshot was taken
     * @param medianPrice Median across all feeds (scaled to 1e18)
     * @param minPrice Minimum price seen
     * @param maxPrice Maximum price seen
     * @param feedCount Number of active feeds
     */
    struct PriceSnapshot {
        uint32 timestamp;
        uint256 medianPrice;
        uint256 minPrice;
        uint256 maxPrice;
        uint8 feedCount;
    }

    /**
     * @notice Volatility calculation parameters
     * @param windowSize Number of samples in rolling window
     * @param sampleInterval Seconds between samples
     * @param annualizationFactor Multiplier to annualize (e.g., sqrt(252) scaled)
     */
    struct VolatilityConfig {
        uint16 windowSize;
        uint32 sampleInterval;
        uint256 annualizationFactor1e18;
    }

    // ============ EVENTS ============

    event FeedAdded(
        bytes32 indexed perilId,
        address indexed feedAddress,
        uint8 decimals,
        uint16 weight
    );

    event FeedRemoved(
        bytes32 indexed perilId,
        address indexed feedAddress
    );

    event FeedWeightUpdated(
        bytes32 indexed perilId,
        address indexed feedAddress,
        uint16 oldWeight,
        uint16 newWeight
    );

    event PriceSnapshotRecorded(
        bytes32 indexed perilId,
        uint32 timestamp,
        uint256 medianPrice,
        uint256 disagreementBps
    );

    event OracleStateComputed(
        bytes32 indexed perilId,
        uint16 pegDevBps,
        uint16 volBps,
        uint16 disagreementBps,
        uint8 shockFlag
    );

    event ShockDetected(
        bytes32 indexed perilId,
        uint8 severity,
        string reason
    );

    // ============ ERRORS ============

    error FeedAlreadyExists(bytes32 perilId, address feedAddress);
    error FeedNotFound(bytes32 perilId, address feedAddress);
    error InsufficientFeeds(bytes32 perilId, uint8 active, uint8 required);
    error StaleFeedData(address feedAddress, uint32 lastUpdate);
    error InvalidWeight(uint16 weight);
    error InvalidVolatilityConfig();

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Get all active feeds for a peril
     * @param perilId Unique peril identifier
     * @return feeds Array of PriceFeed structs
     */
    function getActiveFeeds(bytes32 perilId)
        external
        view
        returns (PriceFeed[] memory feeds);

    /**
     * @notice Get latest price snapshot
     * @param perilId Unique peril identifier
     * @return snapshot Most recent PriceSnapshot
     */
    function getLatestSnapshot(bytes32 perilId)
        external
        view
        returns (PriceSnapshot memory snapshot);

    /**
     * @notice Get historical snapshots for volatility calculation
     * @param perilId Unique peril identifier
     * @param count Number of historical snapshots to retrieve
     * @return snapshots Array of PriceSnapshot (newest first)
     */
    function getHistoricalSnapshots(bytes32 perilId, uint256 count)
        external
        view
        returns (PriceSnapshot[] memory snapshots);

    /**
     * @notice Get volatility configuration
     * @param perilId Unique peril identifier
     * @return config VolatilityConfig struct
     */
    function getVolatilityConfig(bytes32 perilId)
        external
        view
        returns (VolatilityConfig memory config);

    /**
     * @notice Compute current oracle state without writing
     * @param perilId Unique peril identifier
     * @return state Computed OracleState
     */
    function computeOracleState(bytes32 perilId)
        external
        view
        returns (IDsrptHazardEngine.OracleState memory state);

    // ============ KEEPER FUNCTIONS ============

    /**
     * @notice Record new price snapshot (keeper callable)
     * @param perilId Unique peril identifier
     * @dev Queries all active feeds and stores median/min/max
     */
    function recordSnapshot(bytes32 perilId) external;

    /**
     * @notice Compute and push oracle state to hazard engine (keeper callable)
     * @param perilId Unique peril identifier
     * @dev Calculates pegDev, vol, disagreement, shockFlag and pushes to engine
     */
    function updateOracleState(bytes32 perilId) external;

    /**
     * @notice Batch update multiple perils (gas optimization)
     * @param perilIds Array of peril IDs to update
     */
    function batchUpdateOracleState(bytes32[] calldata perilIds) external;

    // ============ GOVERNANCE FUNCTIONS ============

    /**
     * @notice Add new price feed source
     * @param perilId Unique peril identifier
     * @param feedAddress Oracle contract address
     * @param decimals Price decimals
     * @param weight Relative weight (0-10000)
     */
    function addFeed(
        bytes32 perilId,
        address feedAddress,
        uint8 decimals,
        uint16 weight
    ) external;

    /**
     * @notice Remove price feed source
     * @param perilId Unique peril identifier
     * @param feedAddress Oracle contract address
     */
    function removeFeed(
        bytes32 perilId,
        address feedAddress
    ) external;

    /**
     * @notice Update feed weight
     * @param perilId Unique peril identifier
     * @param feedAddress Oracle contract address
     * @param newWeight New weight (0-10000)
     */
    function updateFeedWeight(
        bytes32 perilId,
        address feedAddress,
        uint16 newWeight
    ) external;

    /**
     * @notice Configure volatility calculation
     * @param perilId Unique peril identifier
     * @param config New VolatilityConfig
     */
    function setVolatilityConfig(
        bytes32 perilId,
        VolatilityConfig calldata config
    ) external;

    /**
     * @notice Set hazard engine address (for pushing state)
     * @param engine Address of IDsrptHazardEngine
     */
    function setHazardEngine(address engine) external;
}
