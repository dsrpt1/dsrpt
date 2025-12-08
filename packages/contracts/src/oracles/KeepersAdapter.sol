// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AutomationCompatibleInterface} from "../interfaces/AutomationCompatibleInterface.sol";
import {IDsrptPolicyManager} from "../interfaces/IDsrptPolicyManager.sol";
import {IDsrptHazardEngine} from "../interfaces/IDsrptHazardEngine.sol";
import {OracleAggregator} from "./OracleAggregator.sol";
import {DsrptTreasuryManager} from "../core/DsrptTreasuryManager.sol";

/**
 * @title KeepersAdapter
 * @notice Chainlink Automation compatible keeper for DSRPT Protocol
 * @dev Performs automated tasks:
 *      - Oracle state updates (every 5-10 minutes)
 *      - Policy checkpoints (daily)
 *      - Portfolio/tranche state updates (hourly)
 *      - Expired policy settlement
 *
 * Register with Chainlink Automation:
 * https://automation.chain.link/
 */
contract KeepersAdapter is AutomationCompatibleInterface {
    // ============ STRUCTS ============

    /**
     * @notice Task types for upkeep
     */
    enum TaskType {
        OracleUpdate,      // Update oracle state for perils
        PolicyCheckpoint,  // Checkpoint streaming/escrow policies
        PortfolioUpdate,   // Update portfolio/tranche state
        ExpiredSettle      // Settle expired policies
    }

    /**
     * @notice Configuration for a registered peril
     */
    struct PerilConfig {
        bytes32 perilId;
        uint32 oracleInterval;      // Seconds between oracle updates (e.g., 300 = 5 min)
        uint32 portfolioInterval;   // Seconds between portfolio updates (e.g., 3600 = 1 hour)
        uint32 lastOracleUpdate;
        uint32 lastPortfolioUpdate;
        bool active;
    }

    // ============ STORAGE ============

    /// @notice Oracle aggregator contract
    OracleAggregator public oracleAggregator;

    /// @notice Policy manager contract
    IDsrptPolicyManager public policyManager;

    /// @notice Treasury manager contract
    DsrptTreasuryManager public treasuryManager;

    /// @notice Contract owner
    address public owner;

    /// @notice Registered perils
    bytes32[] public registeredPerils;

    /// @notice Peril configurations
    mapping(bytes32 => PerilConfig) public perilConfigs;

    /// @notice Policy IDs to checkpoint (managed externally or via registration)
    uint256[] public registeredPolicies;

    /// @notice Policy checkpoint interval (e.g., 86400 = 1 day)
    uint32 public policyCheckpointInterval = 86400;

    /// @notice Last policy checkpoint timestamp
    uint32 public lastPolicyCheckpoint;

    /// @notice Maximum policies to process per upkeep
    uint16 public maxPoliciesPerUpkeep = 50;

    /// @notice Maximum perils to process per upkeep
    uint8 public maxPerilsPerUpkeep = 10;

    /// @notice Gas limit for upkeep
    uint256 public gasLimit = 5_000_000;

    // ============ EVENTS ============

    event PerilRegistered(bytes32 indexed perilId, uint32 oracleInterval, uint32 portfolioInterval);
    event PerilDeregistered(bytes32 indexed perilId);
    event PolicyRegistered(uint256 indexed policyId);
    event PolicyDeregistered(uint256 indexed policyId);
    event OracleUpdated(bytes32 indexed perilId, uint32 timestamp);
    event PortfolioUpdated(bytes32 indexed perilId, uint32 timestamp);
    event PoliciesCheckpointed(uint256 count, uint32 timestamp);
    event UpkeepPerformed(TaskType taskType, uint256 itemsProcessed);

    // ============ MODIFIERS ============

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // ============ CONSTRUCTOR ============

    constructor(
        address _oracleAggregator,
        address _policyManager,
        address _treasuryManager
    ) {
        oracleAggregator = OracleAggregator(_oracleAggregator);
        policyManager = IDsrptPolicyManager(_policyManager);
        treasuryManager = DsrptTreasuryManager(_treasuryManager);
        owner = msg.sender;
        lastPolicyCheckpoint = uint32(block.timestamp);
    }

    // ============ CHAINLINK AUTOMATION ============

    /**
     * @notice Check if upkeep is needed
     * @dev Called by Chainlink Automation nodes off-chain
     * @return upkeepNeeded True if upkeep should be performed
     * @return performData Encoded data for performUpkeep
     */
    function checkUpkeep(bytes calldata /* checkData */)
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        // Priority 1: Oracle updates (most time-sensitive)
        (bool oracleNeeded, bytes32[] memory oraclePerils) = _checkOracleUpdates();
        if (oracleNeeded) {
            return (true, abi.encode(TaskType.OracleUpdate, oraclePerils));
        }

        // Priority 2: Policy checkpoints (daily)
        if (_checkPolicyCheckpoints()) {
            return (true, abi.encode(TaskType.PolicyCheckpoint, new bytes32[](0)));
        }

        // Priority 3: Portfolio updates (hourly)
        (bool portfolioNeeded, bytes32[] memory portfolioPerils) = _checkPortfolioUpdates();
        if (portfolioNeeded) {
            return (true, abi.encode(TaskType.PortfolioUpdate, portfolioPerils));
        }

        // Priority 4: Expired policy settlement
        if (_checkExpiredPolicies()) {
            return (true, abi.encode(TaskType.ExpiredSettle, new bytes32[](0)));
        }

        return (false, "");
    }

    /**
     * @notice Perform upkeep
     * @dev Called by Chainlink Automation nodes on-chain
     * @param performData Encoded task data from checkUpkeep
     */
    function performUpkeep(bytes calldata performData) external override {
        (TaskType taskType, bytes32[] memory perils) = abi.decode(performData, (TaskType, bytes32[]));

        uint256 itemsProcessed = 0;

        if (taskType == TaskType.OracleUpdate) {
            itemsProcessed = _performOracleUpdates(perils);
        } else if (taskType == TaskType.PolicyCheckpoint) {
            itemsProcessed = _performPolicyCheckpoints();
        } else if (taskType == TaskType.PortfolioUpdate) {
            itemsProcessed = _performPortfolioUpdates(perils);
        } else if (taskType == TaskType.ExpiredSettle) {
            itemsProcessed = _performExpiredSettlement();
        }

        emit UpkeepPerformed(taskType, itemsProcessed);
    }

    // ============ CHECK FUNCTIONS ============

    /**
     * @dev Check if any oracle updates are needed
     */
    function _checkOracleUpdates() internal view returns (bool needed, bytes32[] memory perils) {
        uint256 count = 0;
        bytes32[] memory temp = new bytes32[](registeredPerils.length);

        for (uint256 i = 0; i < registeredPerils.length && count < maxPerilsPerUpkeep; i++) {
            bytes32 perilId = registeredPerils[i];
            PerilConfig storage config = perilConfigs[perilId];

            if (!config.active) continue;

            if (block.timestamp >= config.lastOracleUpdate + config.oracleInterval) {
                temp[count++] = perilId;
            }
        }

        if (count > 0) {
            perils = new bytes32[](count);
            for (uint256 i = 0; i < count; i++) {
                perils[i] = temp[i];
            }
            return (true, perils);
        }

        return (false, new bytes32[](0));
    }

    /**
     * @dev Check if policy checkpoints are needed
     */
    function _checkPolicyCheckpoints() internal view returns (bool) {
        return block.timestamp >= lastPolicyCheckpoint + policyCheckpointInterval &&
               registeredPolicies.length > 0;
    }

    /**
     * @dev Check if portfolio updates are needed
     */
    function _checkPortfolioUpdates() internal view returns (bool needed, bytes32[] memory perils) {
        uint256 count = 0;
        bytes32[] memory temp = new bytes32[](registeredPerils.length);

        for (uint256 i = 0; i < registeredPerils.length && count < maxPerilsPerUpkeep; i++) {
            bytes32 perilId = registeredPerils[i];
            PerilConfig storage config = perilConfigs[perilId];

            if (!config.active) continue;

            if (block.timestamp >= config.lastPortfolioUpdate + config.portfolioInterval) {
                temp[count++] = perilId;
            }
        }

        if (count > 0) {
            perils = new bytes32[](count);
            for (uint256 i = 0; i < count; i++) {
                perils[i] = temp[i];
            }
            return (true, perils);
        }

        return (false, new bytes32[](0));
    }

    /**
     * @dev Check if any expired policies need settlement
     */
    function _checkExpiredPolicies() internal view returns (bool) {
        for (uint256 i = 0; i < registeredPolicies.length; i++) {
            IDsrptPolicyManager.Policy memory p = policyManager.getPolicy(registeredPolicies[i]);
            if (p.status == IDsrptPolicyManager.PolicyStatus.Active &&
                block.timestamp >= p.endTime) {
                return true;
            }
        }
        return false;
    }

    // ============ PERFORM FUNCTIONS ============

    /**
     * @dev Perform oracle updates
     */
    function _performOracleUpdates(bytes32[] memory perils) internal returns (uint256) {
        uint256 processed = 0;

        for (uint256 i = 0; i < perils.length; i++) {
            bytes32 perilId = perils[i];

            try oracleAggregator.updateOracleState(perilId) {
                perilConfigs[perilId].lastOracleUpdate = uint32(block.timestamp);
                emit OracleUpdated(perilId, uint32(block.timestamp));
                processed++;
            } catch {
                // Continue with other updates
            }
        }

        return processed;
    }

    /**
     * @dev Perform policy checkpoints
     */
    function _performPolicyCheckpoints() internal returns (uint256) {
        uint256 processed = 0;
        uint256[] memory toCheckpoint = new uint256[](maxPoliciesPerUpkeep);
        uint256 count = 0;

        // Collect policies needing checkpoint
        for (uint256 i = 0; i < registeredPolicies.length && count < maxPoliciesPerUpkeep; i++) {
            uint256 policyId = registeredPolicies[i];
            IDsrptPolicyManager.Policy memory p = policyManager.getPolicy(policyId);

            if (p.status == IDsrptPolicyManager.PolicyStatus.Active) {
                toCheckpoint[count++] = policyId;
            }
        }

        // Batch checkpoint
        if (count > 0) {
            uint256[] memory batch = new uint256[](count);
            for (uint256 i = 0; i < count; i++) {
                batch[i] = toCheckpoint[i];
            }

            try policyManager.batchCheckpoint(batch) {
                processed = count;
            } catch {
                // Try individual checkpoints
                for (uint256 i = 0; i < count; i++) {
                    try policyManager.batchCheckpoint(_singleArray(batch[i])) {
                        processed++;
                    } catch {
                        // Skip failed policy
                    }
                }
            }
        }

        lastPolicyCheckpoint = uint32(block.timestamp);
        emit PoliciesCheckpointed(processed, uint32(block.timestamp));

        return processed;
    }

    /**
     * @dev Perform portfolio/tranche updates
     */
    function _performPortfolioUpdates(bytes32[] memory perils) internal returns (uint256) {
        uint256 processed = 0;

        for (uint256 i = 0; i < perils.length; i++) {
            bytes32 perilId = perils[i];

            try treasuryManager.updatePortfolioState(perilId) {
                try treasuryManager.updateTrancheState(perilId) {
                    perilConfigs[perilId].lastPortfolioUpdate = uint32(block.timestamp);
                    emit PortfolioUpdated(perilId, uint32(block.timestamp));
                    processed++;
                } catch {}
            } catch {
                // Continue with other updates
            }
        }

        return processed;
    }

    /**
     * @dev Settle expired policies
     */
    function _performExpiredSettlement() internal returns (uint256) {
        uint256 processed = 0;

        for (uint256 i = 0; i < registeredPolicies.length && processed < maxPoliciesPerUpkeep; i++) {
            uint256 policyId = registeredPolicies[i];
            IDsrptPolicyManager.Policy memory p = policyManager.getPolicy(policyId);

            if (p.status == IDsrptPolicyManager.PolicyStatus.Active &&
                block.timestamp >= p.endTime) {
                try policyManager.settleExpiredPolicy(policyId) {
                    processed++;
                } catch {
                    // Continue with other policies
                }
            }
        }

        return processed;
    }

    // ============ REGISTRATION FUNCTIONS ============

    /**
     * @notice Register a peril for automated updates
     * @param perilId Peril identifier
     * @param oracleInterval Seconds between oracle updates
     * @param portfolioInterval Seconds between portfolio updates
     */
    function registerPeril(
        bytes32 perilId,
        uint32 oracleInterval,
        uint32 portfolioInterval
    ) external onlyOwner {
        require(perilId != bytes32(0), "Invalid peril");
        require(oracleInterval >= 60, "Oracle interval too short");
        require(portfolioInterval >= 300, "Portfolio interval too short");

        if (!perilConfigs[perilId].active) {
            registeredPerils.push(perilId);
        }

        perilConfigs[perilId] = PerilConfig({
            perilId: perilId,
            oracleInterval: oracleInterval,
            portfolioInterval: portfolioInterval,
            lastOracleUpdate: uint32(block.timestamp),
            lastPortfolioUpdate: uint32(block.timestamp),
            active: true
        });

        emit PerilRegistered(perilId, oracleInterval, portfolioInterval);
    }

    /**
     * @notice Deregister a peril
     * @param perilId Peril to deregister
     */
    function deregisterPeril(bytes32 perilId) external onlyOwner {
        perilConfigs[perilId].active = false;
        emit PerilDeregistered(perilId);
    }

    /**
     * @notice Register a policy for automated checkpoints
     * @param policyId Policy identifier
     */
    function registerPolicy(uint256 policyId) external onlyOwner {
        registeredPolicies.push(policyId);
        emit PolicyRegistered(policyId);
    }

    /**
     * @notice Batch register policies
     * @param policyIds Array of policy identifiers
     */
    function registerPolicies(uint256[] calldata policyIds) external onlyOwner {
        for (uint256 i = 0; i < policyIds.length; i++) {
            registeredPolicies.push(policyIds[i]);
            emit PolicyRegistered(policyIds[i]);
        }
    }

    /**
     * @notice Remove inactive policies from registry
     * @dev Call periodically to clean up
     */
    function cleanupPolicies() external {
        uint256 writeIdx = 0;

        for (uint256 i = 0; i < registeredPolicies.length; i++) {
            IDsrptPolicyManager.Policy memory p = policyManager.getPolicy(registeredPolicies[i]);

            if (p.status == IDsrptPolicyManager.PolicyStatus.Active) {
                registeredPolicies[writeIdx++] = registeredPolicies[i];
            }
        }

        // Trim array
        while (registeredPolicies.length > writeIdx) {
            registeredPolicies.pop();
        }
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Update checkpoint interval
     * @param interval New interval in seconds
     */
    function setPolicyCheckpointInterval(uint32 interval) external onlyOwner {
        require(interval >= 3600, "Interval too short");
        policyCheckpointInterval = interval;
    }

    /**
     * @notice Update max policies per upkeep
     * @param max New maximum
     */
    function setMaxPoliciesPerUpkeep(uint16 max) external onlyOwner {
        maxPoliciesPerUpkeep = max;
    }

    /**
     * @notice Update max perils per upkeep
     * @param max New maximum
     */
    function setMaxPerilsPerUpkeep(uint8 max) external onlyOwner {
        maxPerilsPerUpkeep = max;
    }

    /**
     * @notice Update contract references
     */
    function setOracleAggregator(address _oracle) external onlyOwner {
        oracleAggregator = OracleAggregator(_oracle);
    }

    function setPolicyManager(address _policyManager) external onlyOwner {
        policyManager = IDsrptPolicyManager(_policyManager);
    }

    function setTreasuryManager(address _treasury) external onlyOwner {
        treasuryManager = DsrptTreasuryManager(_treasury);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Get all registered perils
     */
    function getRegisteredPerils() external view returns (bytes32[] memory) {
        return registeredPerils;
    }

    /**
     * @notice Get all registered policies
     */
    function getRegisteredPolicies() external view returns (uint256[] memory) {
        return registeredPolicies;
    }

    /**
     * @notice Get active peril count
     */
    function getActivePerilCount() external view returns (uint256 count) {
        for (uint256 i = 0; i < registeredPerils.length; i++) {
            if (perilConfigs[registeredPerils[i]].active) {
                count++;
            }
        }
    }

    // ============ INTERNAL HELPERS ============

    function _singleArray(uint256 value) internal pure returns (uint256[] memory arr) {
        arr = new uint256[](1);
        arr[0] = value;
    }
}
