// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IDsrptHazardEngine} from "./IDsrptHazardEngine.sol";

/**
 * @title IDsrptTreasuryManager
 * @notice Manages collateral pools, tranches, and capital allocations
 * @dev Computes portfolio/tranche state and pushes to HazardEngine
 */
interface IDsrptTreasuryManager {

    // ============ STRUCTS ============

    /**
     * @notice Tranche configuration
     * @param trancheId 0=junior, 1=mezz, 2=senior
     * @param targetYieldBps Target annual yield in basis points
     * @param poolShareBps Percentage of total pool (0-10000)
     * @param capacity Maximum capital in this tranche
     * @param deployed Currently deployed capital
     */
    struct TrancheConfig {
        uint8 trancheId;
        uint32 targetYieldBps;
        uint32 poolShareBps;
        uint256 capacity;
        uint256 deployed;
    }

    /**
     * @notice Capital deposit record
     * @param depositor LP address
     * @param trancheId Which tranche (0/1/2)
     * @param amount Deposited amount
     * @param shares Shares minted
     * @param depositedAt Timestamp
     */
    struct Deposit {
        address depositor;
        uint8 trancheId;
        uint256 amount;
        uint256 shares;
        uint32 depositedAt;
    }

    /**
     * @notice Withdrawal request
     * @param depositor LP address
     * @param trancheId Which tranche
     * @param shares Shares to redeem
     * @param requestedAt Timestamp of request
     * @param availableAt Earliest withdrawal time (after cooldown)
     */
    struct WithdrawalRequest {
        address depositor;
        uint8 trancheId;
        uint256 shares;
        uint32 requestedAt;
        uint32 availableAt;
    }

    /**
     * @notice Per-peril risk allocation
     * @param perilId Unique peril identifier
     * @param allocatedCapital Capital reserved for this peril
     * @param openExposure Sum of active policy limits
     * @param expectedLoss Sum of (limit × H(T)) for active policies
     */
    struct PerilAllocation {
        bytes32 perilId;
        uint256 allocatedCapital;
        uint256 openExposure;
        uint256 expectedLoss;
    }

    // ============ EVENTS ============

    event TrancheConfigured(
        uint8 indexed trancheId,
        uint32 targetYieldBps,
        uint32 poolShareBps,
        uint256 capacity
    );

    event CapitalDeposited(
        address indexed depositor,
        uint8 indexed trancheId,
        uint256 amount,
        uint256 shares
    );

    event WithdrawalRequested(
        address indexed depositor,
        uint8 indexed trancheId,
        uint256 shares,
        uint32 availableAt
    );

    event WithdrawalExecuted(
        address indexed depositor,
        uint8 indexed trancheId,
        uint256 shares,
        uint256 amount
    );

    event ClaimPaidFromTranche(
        uint256 indexed policyId,
        uint8 trancheId,
        uint256 amount
    );

    event PerilAllocationUpdated(
        bytes32 indexed perilId,
        uint256 allocatedCapital,
        uint256 openExposure
    );

    event PortfolioStateComputed(
        bytes32 indexed perilId,
        uint16 utilizationBps,
        uint16 capitalRatioBps
    );

    // ============ ERRORS ============

    error InsufficientCapacity(uint8 trancheId, uint256 requested, uint256 available);
    error WithdrawalCooldownActive(address depositor, uint32 availableAt);
    error InvalidTrancheId(uint8 trancheId);
    error ExcessiveUtilization(uint256 utilizationBps, uint256 max);
    error InsufficientLiquidity(uint256 required, uint256 available);

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Get tranche configuration
     * @param trancheId 0=junior, 1=mezz, 2=senior
     * @return config TrancheConfig struct
     */
    function getTrancheConfig(uint8 trancheId)
        external
        view
        returns (TrancheConfig memory config);

    /**
     * @notice Get total pool statistics
     * @return totalAssets Sum of all deposited capital
     * @return totalLiabilities Sum of all expected losses
     * @return availableCapital Assets minus liabilities
     */
    function getPoolStats()
        external
        view
        returns (
            uint256 totalAssets,
            uint256 totalLiabilities,
            uint256 availableCapital
        );

    /**
     * @notice Get per-peril allocation
     * @param perilId Unique peril identifier
     * @return allocation PerilAllocation struct
     */
    function getPerilAllocation(bytes32 perilId)
        external
        view
        returns (PerilAllocation memory allocation);

    /**
     * @notice Get depositor position in tranche
     * @param depositor LP address
     * @param trancheId Tranche ID
     * @return shares Current share balance
     * @return value Current redemption value in USD
     */
    function getDepositorPosition(address depositor, uint8 trancheId)
        external
        view
        returns (uint256 shares, uint256 value);

    /**
     * @notice Get pending withdrawal request
     * @param depositor LP address
     * @param trancheId Tranche ID
     * @return request WithdrawalRequest struct (zero if none)
     */
    function getPendingWithdrawal(address depositor, uint8 trancheId)
        external
        view
        returns (WithdrawalRequest memory request);

    /**
     * @notice Compute current portfolio state without writing
     * @param perilId Unique peril identifier
     * @return state Computed PortfolioState
     */
    function computePortfolioState(bytes32 perilId)
        external
        view
        returns (IDsrptHazardEngine.PortfolioState memory state);

    /**
     * @notice Compute current tranche state without writing
     * @param perilId Unique peril identifier
     * @return state Computed TrancheState
     */
    function computeTrancheState(bytes32 perilId)
        external
        view
        returns (IDsrptHazardEngine.TrancheState memory state);

    // ============ LP FUNCTIONS ============

    /**
     * @notice Deposit capital into tranche
     * @param trancheId 0=junior, 1=mezz, 2=senior
     * @param amount USD amount to deposit
     * @return shares Shares minted
     */
    function deposit(uint8 trancheId, uint256 amount)
        external
        returns (uint256 shares);

    /**
     * @notice Request withdrawal from tranche
     * @param trancheId Tranche ID
     * @param shares Shares to redeem
     * @dev Begins cooldown period, can execute after availableAt
     */
    function requestWithdrawal(uint8 trancheId, uint256 shares) external;

    /**
     * @notice Execute pending withdrawal after cooldown
     * @param trancheId Tranche ID
     * @return amount USD amount withdrawn
     */
    function executeWithdrawal(uint8 trancheId)
        external
        returns (uint256 amount);

    /**
     * @notice Cancel pending withdrawal request
     * @param trancheId Tranche ID
     */
    function cancelWithdrawal(uint8 trancheId) external;

    // ============ CLAIMS SETTLEMENT ============

    /**
     * @notice Pay claim using tranche waterfall
     * @param policyId Policy being claimed
     * @param amount Payout amount
     * @dev Deducts from junior -> mezz -> senior until covered
     */
    function payClaim(uint256 policyId, uint256 amount) external;

    /**
     * @notice Allocate capital to new policy
     * @param perilId Peril being insured
     * @param expectedLoss Policy's expected loss (limit × H(T))
     */
    function allocateToPolicy(bytes32 perilId, uint256 expectedLoss) external;

    /**
     * @notice Release capital from expired/cancelled policy
     * @param perilId Peril being insured
     * @param expectedLoss Policy's expected loss
     */
    function releaseFromPolicy(bytes32 perilId, uint256 expectedLoss) external;

    // ============ STATE UPDATES ============

    /**
     * @notice Compute and push portfolio state to hazard engine
     * @param perilId Unique peril identifier
     */
    function updatePortfolioState(bytes32 perilId) external;

    /**
     * @notice Compute and push tranche state to hazard engine
     * @param perilId Unique peril identifier
     */
    function updateTrancheState(bytes32 perilId) external;

    /**
     * @notice Batch update multiple perils
     * @param perilIds Array of peril IDs
     */
    function batchUpdateStates(bytes32[] calldata perilIds) external;

    // ============ GOVERNANCE FUNCTIONS ============

    /**
     * @notice Configure tranche parameters
     * @param config Complete TrancheConfig
     */
    function setTrancheConfig(TrancheConfig calldata config) external;

    /**
     * @notice Set withdrawal cooldown period
     * @param cooldownSeconds Seconds between request and execution
     */
    function setWithdrawalCooldown(uint32 cooldownSeconds) external;

    /**
     * @notice Set maximum utilization threshold
     * @param maxUtilizationBps Maximum allowed (0-10000)
     */
    function setMaxUtilization(uint16 maxUtilizationBps) external;

    /**
     * @notice Set hazard engine address (for pushing state)
     * @param engine Address of IDsrptHazardEngine
     */
    function setHazardEngine(address engine) external;
}
