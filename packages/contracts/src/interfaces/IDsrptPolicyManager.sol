// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IDsrptHazardEngine} from "./IDsrptHazardEngine.sol";

/**
 * @title IDsrptPolicyManager
 * @notice Manages policy lifecycle including issuance, streaming premiums, and claims
 * @dev Integrates with HazardEngine for pricing and settlement
 */
interface IDsrptPolicyManager {

    // ============ ENUMS ============

    enum PolicyStatus {
        Active,
        Claimed,
        Expired,
        Cancelled
    }

    enum PremiumModel {
        FixedUpfront,      // Traditional: pay full premium at issuance
        StreamingBalance,  // Dynamic: premium adjusts with balance
        CheckpointEscrow   // Hybrid: escrow with periodic settlement
    }

    // ============ STRUCTS ============

    /**
     * @notice Core policy data
     * @param policyId Unique identifier (incremental or hash)
     * @param perilId Links to hazard engine configuration
     * @param holder Policy owner address
     * @param insuredAddress Address with balance being insured (may differ from holder)
     * @param startTime Policy inception timestamp
     * @param endTime Policy expiration timestamp
     * @param coverageLimit Maximum payout in USD
     * @param premiumModel How premiums are collected
     * @param status Current policy state
     */
    struct Policy {
        uint256 policyId;
        bytes32 perilId;
        address holder;
        address insuredAddress;
        uint32 startTime;
        uint32 endTime;
        uint256 coverageLimit;
        PremiumModel premiumModel;
        PolicyStatus status;
    }

    /**
     * @notice Fixed upfront premium policy data
     * @param totalPremium Amount paid at issuance
     * @param paidAt Timestamp of payment
     */
    struct FixedPremiumData {
        uint256 totalPremium;
        uint32 paidAt;
    }

    /**
     * @notice Streaming balance-adjusted premium data
     * @param lastCheckpoint Last time premium was accrued
     * @param accruedPremium Running total of premium charged
     * @param maxCoverage Cap on coverage to prevent gaming
     */
    struct StreamingPremiumData {
        uint32 lastCheckpoint;
        uint256 accruedPremium;
        uint256 maxCoverage;
    }

    /**
     * @notice Checkpoint-based escrow premium data
     * @param escrowBalance Remaining pre-funded amount
     * @param accruedPremium Total premium charged to date
     * @param lastCheckpoint Last checkpoint timestamp
     * @param checkpointInterval Seconds between checkpoints (e.g., 86400 = 1 day)
     */
    struct CheckpointPremiumData {
        uint256 escrowBalance;
        uint256 accruedPremium;
        uint32 lastCheckpoint;
        uint32 checkpointInterval;
    }

    /**
     * @notice Claim details
     * @param policyId Associated policy
     * @param claimedAt Timestamp of claim
     * @param depegBps Severity of depeg in basis points
     * @param durationHours Duration trigger was active
     * @param payoutAmount Amount paid to holder
     */
    struct Claim {
        uint256 policyId;
        uint32 claimedAt;
        uint256 depegBps;
        uint256 durationHours;
        uint256 payoutAmount;
    }

    // ============ EVENTS ============

    event PolicyIssued(
        uint256 indexed policyId,
        bytes32 indexed perilId,
        address indexed holder,
        address insuredAddress,
        uint256 coverageLimit,
        uint32 startTime,
        uint32 endTime,
        PremiumModel premiumModel
    );

    event PremiumCharged(
        uint256 indexed policyId,
        uint256 amount,
        uint32 timestamp
    );

    event CheckpointProcessed(
        uint256 indexed policyId,
        uint256 coveredBalance,
        uint256 dailyPremium,
        uint32 timestamp
    );

    event PolicyClaimed(
        uint256 indexed policyId,
        uint256 depegBps,
        uint256 durationHours,
        uint256 payoutAmount,
        uint32 timestamp
    );

    event PolicyExpired(
        uint256 indexed policyId,
        uint32 timestamp
    );

    event PolicyCancelled(
        uint256 indexed policyId,
        uint256 refundAmount,
        uint32 timestamp
    );

    event EscrowTopUp(
        uint256 indexed policyId,
        uint256 amount,
        address from
    );

    // ============ ERRORS ============

    error PolicyNotFound(uint256 policyId);
    error PolicyNotActive(uint256 policyId, PolicyStatus status);
    error InsufficientEscrow(uint256 policyId, uint256 required, uint256 available);
    error CheckpointTooEarly(uint256 policyId, uint32 lastCheckpoint, uint32 interval);
    error InvalidCoverageLimit(uint256 limit);
    error InvalidDuration(uint32 startTime, uint32 endTime);
    error TriggerNotMet(bytes32 perilId);
    error AlreadyClaimed(uint256 policyId);

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Get policy details
     * @param policyId Unique policy identifier
     * @return policy Core policy struct
     */
    function getPolicy(uint256 policyId)
        external
        view
        returns (Policy memory policy);

    /**
     * @notice Get fixed premium data
     * @param policyId Unique policy identifier
     * @return data FixedPremiumData struct
     */
    function getFixedPremiumData(uint256 policyId)
        external
        view
        returns (FixedPremiumData memory data);

    /**
     * @notice Get streaming premium data
     * @param policyId Unique policy identifier
     * @return data StreamingPremiumData struct
     */
    function getStreamingPremiumData(uint256 policyId)
        external
        view
        returns (StreamingPremiumData memory data);

    /**
     * @notice Get checkpoint premium data
     * @param policyId Unique policy identifier
     * @return data CheckpointPremiumData struct
     */
    function getCheckpointPremiumData(uint256 policyId)
        external
        view
        returns (CheckpointPremiumData memory data);

    /**
     * @notice Get claim details if policy was claimed
     * @param policyId Unique policy identifier
     * @return claim Claim struct (zero values if not claimed)
     */
    function getClaim(uint256 policyId)
        external
        view
        returns (Claim memory claim);

    /**
     * @notice Get all active policies for a holder
     * @param holder Address to query
     * @return policyIds Array of active policy IDs
     */
    function getActivePolicies(address holder)
        external
        view
        returns (uint256[] memory policyIds);

    /**
     * @notice Calculate current accrued premium for streaming/checkpoint policy
     * @param policyId Unique policy identifier
     * @return accrued Total premium accrued to current timestamp
     */
    function calculateAccruedPremium(uint256 policyId)
        external
        view
        returns (uint256 accrued);

    // ============ ISSUANCE FUNCTIONS ============

    /**
     * @notice Issue fixed upfront premium policy
     * @param perilId Which peril to insure
     * @param insuredAddress Address with balance to insure
     * @param coverageLimit Maximum payout
     * @param durationDays Policy duration in days
     * @return policyId Newly created policy ID
     */
    function issueFixedPolicy(
        bytes32 perilId,
        address insuredAddress,
        uint256 coverageLimit,
        uint32 durationDays
    ) external returns (uint256 policyId);

    /**
     * @notice Issue streaming balance-adjusted policy
     * @param perilId Which peril to insure
     * @param insuredAddress Address with balance to insure (will be monitored)
     * @param maxCoverage Cap on coverage (prevents gaming)
     * @param durationDays Policy duration in days
     * @return policyId Newly created policy ID
     */
    function issueStreamingPolicy(
        bytes32 perilId,
        address insuredAddress,
        uint256 maxCoverage,
        uint32 durationDays
    ) external returns (uint256 policyId);

    /**
     * @notice Issue checkpoint-based escrow policy
     * @param perilId Which peril to insure
     * @param insuredAddress Address with balance to insure
     * @param maxCoverage Cap on coverage
     * @param durationDays Policy duration in days
     * @param escrowAmount Initial escrow deposit
     * @param checkpointInterval Seconds between checkpoints (e.g., 86400)
     * @return policyId Newly created policy ID
     */
    function issueCheckpointPolicy(
        bytes32 perilId,
        address insuredAddress,
        uint256 maxCoverage,
        uint32 durationDays,
        uint256 escrowAmount,
        uint32 checkpointInterval
    ) external returns (uint256 policyId);

    // ============ PREMIUM COLLECTION ============

    /**
     * @notice Process daily checkpoint for streaming policy (keeper callable)
     * @param policyId Policy to checkpoint
     */
    function checkpointStreamingPolicy(uint256 policyId) external;

    /**
     * @notice Process checkpoint for escrow policy (keeper callable)
     * @param policyId Policy to checkpoint
     */
    function checkpointEscrowPolicy(uint256 policyId) external;

    /**
     * @notice Batch checkpoint multiple policies (gas optimization)
     * @param policyIds Array of policy IDs to checkpoint
     */
    function batchCheckpoint(uint256[] calldata policyIds) external;

    /**
     * @notice Top up escrow balance for checkpoint policy
     * @param policyId Policy to top up
     * @param amount Amount to add to escrow
     */
    function topUpEscrow(uint256 policyId, uint256 amount) external;

    // ============ CLAIMS & SETTLEMENT ============

    /**
     * @notice Submit claim for triggered policy
     * @param policyId Policy to claim against
     * @param depegBps Observed depeg severity in basis points
     * @param durationHours Observed trigger duration in hours
     * @dev Validates trigger via oracle, calculates payout via hazard engine
     */
    function submitClaim(
        uint256 policyId,
        uint256 depegBps,
        uint256 durationHours
    ) external;

    /**
     * @notice Automated claim processing (keeper callable)
     * @param policyId Policy to process
     * @dev Fetches trigger data from oracle automatically
     */
    function processClaimAutomatic(uint256 policyId) external;

    // ============ CANCELLATION ============

    /**
     * @notice Cancel active policy (pro-rated refund)
     * @param policyId Policy to cancel
     * @return refundAmount Amount refunded to holder
     */
    function cancelPolicy(uint256 policyId)
        external
        returns (uint256 refundAmount);

    /**
     * @notice Settle expired policy (refund unused escrow)
     * @param policyId Policy to settle
     * @return refundAmount Amount refunded to holder
     */
    function settleExpiredPolicy(uint256 policyId)
        external
        returns (uint256 refundAmount);
}
