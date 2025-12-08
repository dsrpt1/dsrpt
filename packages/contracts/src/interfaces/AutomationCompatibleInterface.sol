// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AutomationCompatibleInterface
 * @notice Interface for Chainlink Automation (formerly Keepers)
 * @dev Implement this interface for contracts that need automated upkeep
 *
 * To register with Chainlink Automation:
 * 1. Deploy contract implementing this interface
 * 2. Go to https://automation.chain.link/
 * 3. Register new upkeep with contract address
 * 4. Fund with LINK tokens
 *
 * Documentation: https://docs.chain.link/chainlink-automation
 */
interface AutomationCompatibleInterface {
    /**
     * @notice Check if upkeep is needed
     * @dev Called by Chainlink nodes off-chain to determine if performUpkeep should be called
     *      Should be gas-efficient as it's called frequently
     *      Must not modify state
     * @param checkData Optional data passed during registration (can be empty)
     * @return upkeepNeeded True if performUpkeep should be called
     * @return performData Data to pass to performUpkeep (encoded task info)
     */
    function checkUpkeep(bytes calldata checkData)
        external
        view
        returns (bool upkeepNeeded, bytes memory performData);

    /**
     * @notice Perform the upkeep
     * @dev Called by Chainlink nodes on-chain when checkUpkeep returns true
     *      Should verify conditions are still valid before executing
     *      Gas limit is configurable during registration
     * @param performData Data returned by checkUpkeep
     */
    function performUpkeep(bytes calldata performData) external;
}

/**
 * @title AutomationBase
 * @notice Base contract with common patterns for Chainlink Automation
 */
abstract contract AutomationBase {
    /**
     * @dev Prevent execution by non-forwarder addresses
     *      In production, restrict to Chainlink's forwarder
     */
    error OnlySimulatedBackend();

    /**
     * @notice Check if caller is the Chainlink forwarder
     * @dev Override in production to check actual forwarder address
     */
    function _cannotExecute() internal view virtual returns (bool) {
        // In production, check: msg.sender != chainlinkForwarder
        return false;
    }

    /**
     * @dev Modifier to prevent direct calls (only Chainlink should call)
     */
    modifier cannotExecute() {
        if (_cannotExecute()) {
            revert OnlySimulatedBackend();
        }
        _;
    }
}

/**
 * @title StreamsLookupCompatibleInterface
 * @notice Extended interface for Data Streams integration
 * @dev Use when upkeep needs real-time data from Chainlink Data Streams
 */
interface StreamsLookupCompatibleInterface {
    /**
     * @notice Error to trigger streams lookup
     * @param feedParamKey Key for feed parameter ("feedIDs" for v0.3)
     * @param feeds Array of feed IDs to look up
     * @param timeParamKey Key for time parameter ("timestamp")
     * @param time Timestamp for the lookup
     * @param extraData Additional data to pass through
     */
    error StreamsLookup(
        string feedParamKey,
        string[] feeds,
        string timeParamKey,
        uint256 time,
        bytes extraData
    );

    /**
     * @notice Callback with streams data
     * @param values Array of signed reports from Data Streams
     * @param extraData Data passed through from StreamsLookup
     * @return upkeepNeeded Whether to proceed with upkeep
     * @return performData Data for performUpkeep
     */
    function checkCallback(
        bytes[] calldata values,
        bytes calldata extraData
    ) external view returns (bool upkeepNeeded, bytes memory performData);
}

/**
 * @title LogTriggerAutomation
 * @notice Interface for log-triggered automation
 * @dev Use when upkeep should be triggered by specific events
 */
interface ILogAutomation {
    /**
     * @notice Check log trigger condition
     * @param log The emitted log data
     * @param checkData Registration check data
     * @return upkeepNeeded Whether upkeep should run
     * @return performData Data for performUpkeep
     */
    function checkLog(
        Log calldata log,
        bytes memory checkData
    ) external returns (bool upkeepNeeded, bytes memory performData);

    /**
     * @notice Log data structure
     */
    struct Log {
        uint256 index;
        uint256 timestamp;
        bytes32 txHash;
        uint256 blockNumber;
        bytes32 blockHash;
        address source;
        bytes32[] topics;
        bytes data;
    }
}
