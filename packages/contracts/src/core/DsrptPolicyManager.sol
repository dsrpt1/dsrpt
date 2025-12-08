// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {IDsrptPolicyManager} from "../interfaces/IDsrptPolicyManager.sol";
import {IDsrptHazardEngine} from "../interfaces/IDsrptHazardEngine.sol";
import {IDsrptTreasuryManager} from "../interfaces/IDsrptTreasuryManager.sol";

/**
 * @title DsrptPolicyManager
 * @notice Manages policy lifecycle including issuance, streaming premiums, and claims
 * @dev Integrates with HazardEngine for pricing and TreasuryManager for capital
 *
 * Supports three premium models:
 * - FixedUpfront: Pay full premium at issuance
 * - StreamingBalance: Premium adjusts daily based on insured balance
 * - CheckpointEscrow: Pre-funded escrow with periodic settlement
 */
contract DsrptPolicyManager is IDsrptPolicyManager, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ STORAGE ============

    /// @notice Underlying asset for premiums and payouts (e.g., USDC)
    IERC20 public immutable asset;

    /// @notice Hazard engine for pricing
    IDsrptHazardEngine public hazardEngine;

    /// @notice Treasury manager for capital allocation
    IDsrptTreasuryManager public treasuryManager;

    /// @notice Next policy ID (auto-increment)
    uint256 private _nextPolicyId = 1;

    /// @notice Policy storage
    mapping(uint256 => Policy) private _policies;

    /// @notice Fixed premium data per policy
    mapping(uint256 => FixedPremiumData) private _fixedPremiumData;

    /// @notice Streaming premium data per policy
    mapping(uint256 => StreamingPremiumData) private _streamingPremiumData;

    /// @notice Checkpoint premium data per policy
    mapping(uint256 => CheckpointPremiumData) private _checkpointPremiumData;

    /// @notice Claim data per policy
    mapping(uint256 => Claim) private _claims;

    /// @notice Active policies per holder (for enumeration)
    mapping(address => uint256[]) private _holderPolicies;

    /// @notice Index of policy in holder's array (for efficient removal)
    mapping(uint256 => uint256) private _policyHolderIndex;

    /// @notice Oracle for trigger validation
    address public triggerOracle;

    // ============ ACCESS CONTROL ============

    /// @notice Contract owner
    address public owner;

    /// @notice Keeper address for automated checkpoints
    address public keeper;

    // ============ CONSTANTS ============

    /// @dev Minimum policy duration in days
    uint32 private constant MIN_DURATION_DAYS = 1;

    /// @dev Maximum policy duration in days
    uint32 private constant MAX_DURATION_DAYS = 365;

    /// @dev Seconds per day
    uint32 private constant SECONDS_PER_DAY = 86400;

    // ============ MODIFIERS ============

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyKeeper() {
        require(msg.sender == keeper || msg.sender == owner, "Not keeper");
        _;
    }

    modifier policyExists(uint256 policyId) {
        if (_policies[policyId].policyId == 0) revert PolicyNotFound(policyId);
        _;
    }

    modifier policyActive(uint256 policyId) {
        Policy storage p = _policies[policyId];
        if (p.status != PolicyStatus.Active) revert PolicyNotActive(policyId, p.status);
        _;
    }

    // ============ CONSTRUCTOR ============

    constructor(
        IERC20 _asset,
        address _hazardEngine,
        address _treasuryManager,
        address _keeper
    ) {
        asset = _asset;
        hazardEngine = IDsrptHazardEngine(_hazardEngine);
        treasuryManager = IDsrptTreasuryManager(_treasuryManager);
        keeper = _keeper;
        owner = msg.sender;
    }

    // ============ VIEW FUNCTIONS ============

    /// @inheritdoc IDsrptPolicyManager
    function getPolicy(uint256 policyId)
        external
        view
        override
        returns (Policy memory policy)
    {
        return _policies[policyId];
    }

    /// @inheritdoc IDsrptPolicyManager
    function getFixedPremiumData(uint256 policyId)
        external
        view
        override
        returns (FixedPremiumData memory data)
    {
        return _fixedPremiumData[policyId];
    }

    /// @inheritdoc IDsrptPolicyManager
    function getStreamingPremiumData(uint256 policyId)
        external
        view
        override
        returns (StreamingPremiumData memory data)
    {
        return _streamingPremiumData[policyId];
    }

    /// @inheritdoc IDsrptPolicyManager
    function getCheckpointPremiumData(uint256 policyId)
        external
        view
        override
        returns (CheckpointPremiumData memory data)
    {
        return _checkpointPremiumData[policyId];
    }

    /// @inheritdoc IDsrptPolicyManager
    function getClaim(uint256 policyId)
        external
        view
        override
        returns (Claim memory claim)
    {
        return _claims[policyId];
    }

    /// @inheritdoc IDsrptPolicyManager
    function getActivePolicies(address holder)
        external
        view
        override
        returns (uint256[] memory policyIds)
    {
        uint256[] storage allPolicies = _holderPolicies[holder];
        uint256 activeCount = 0;

        // Count active policies
        for (uint256 i = 0; i < allPolicies.length; i++) {
            if (_policies[allPolicies[i]].status == PolicyStatus.Active) {
                activeCount++;
            }
        }

        // Build active array
        policyIds = new uint256[](activeCount);
        uint256 j = 0;
        for (uint256 i = 0; i < allPolicies.length; i++) {
            if (_policies[allPolicies[i]].status == PolicyStatus.Active) {
                policyIds[j++] = allPolicies[i];
            }
        }
    }

    /// @inheritdoc IDsrptPolicyManager
    function calculateAccruedPremium(uint256 policyId)
        external
        view
        override
        policyExists(policyId)
        returns (uint256 accrued)
    {
        Policy storage p = _policies[policyId];

        if (p.premiumModel == PremiumModel.FixedUpfront) {
            return _fixedPremiumData[policyId].totalPremium;
        } else if (p.premiumModel == PremiumModel.StreamingBalance) {
            StreamingPremiumData storage sd = _streamingPremiumData[policyId];
            uint256 pendingDays = (block.timestamp - sd.lastCheckpoint) / SECONDS_PER_DAY;
            uint256 pendingPremium = _calculateStreamingPremium(policyId, pendingDays);
            return sd.accruedPremium + pendingPremium;
        } else {
            CheckpointPremiumData storage cd = _checkpointPremiumData[policyId];
            uint256 pendingCheckpoints = (block.timestamp - cd.lastCheckpoint) / cd.checkpointInterval;
            uint256 pendingPremium = _calculateCheckpointPremium(policyId, pendingCheckpoints);
            return cd.accruedPremium + pendingPremium;
        }
    }

    // ============ ISSUANCE FUNCTIONS ============

    /// @inheritdoc IDsrptPolicyManager
    function issueFixedPolicy(
        bytes32 perilId,
        address insuredAddress,
        uint256 coverageLimit,
        uint32 durationDays
    ) external override nonReentrant returns (uint256 policyId) {
        _validatePolicyParams(coverageLimit, durationDays);

        // Calculate premium
        uint256 premium = hazardEngine.quotePremium(perilId, durationDays, coverageLimit);

        // Transfer premium from caller
        asset.safeTransferFrom(msg.sender, address(this), premium);

        // Create policy
        policyId = _createPolicy(
            perilId,
            msg.sender,
            insuredAddress,
            coverageLimit,
            durationDays,
            PremiumModel.FixedUpfront
        );

        // Store premium data
        _fixedPremiumData[policyId] = FixedPremiumData({
            totalPremium: premium,
            paidAt: uint32(block.timestamp)
        });

        // Allocate capital in treasury
        uint256 expectedLoss = _calculateExpectedLoss(perilId, coverageLimit, durationDays);
        treasuryManager.allocateToPolicy(perilId, expectedLoss);

        // Transfer premium to treasury
        asset.safeTransfer(address(treasuryManager), premium);

        emit PremiumCharged(policyId, premium, uint32(block.timestamp));
    }

    /// @inheritdoc IDsrptPolicyManager
    function issueStreamingPolicy(
        bytes32 perilId,
        address insuredAddress,
        uint256 maxCoverage,
        uint32 durationDays
    ) external override nonReentrant returns (uint256 policyId) {
        _validatePolicyParams(maxCoverage, durationDays);

        // Create policy (no upfront premium for streaming)
        policyId = _createPolicy(
            perilId,
            msg.sender,
            insuredAddress,
            maxCoverage,
            durationDays,
            PremiumModel.StreamingBalance
        );

        // Store streaming data
        _streamingPremiumData[policyId] = StreamingPremiumData({
            lastCheckpoint: uint32(block.timestamp),
            accruedPremium: 0,
            maxCoverage: maxCoverage
        });

        // Allocate capital based on max coverage
        uint256 expectedLoss = _calculateExpectedLoss(perilId, maxCoverage, durationDays);
        treasuryManager.allocateToPolicy(perilId, expectedLoss);
    }

    /// @inheritdoc IDsrptPolicyManager
    function issueCheckpointPolicy(
        bytes32 perilId,
        address insuredAddress,
        uint256 maxCoverage,
        uint32 durationDays,
        uint256 escrowAmount,
        uint32 checkpointInterval
    ) external override nonReentrant returns (uint256 policyId) {
        _validatePolicyParams(maxCoverage, durationDays);
        require(escrowAmount > 0, "Zero escrow");
        require(checkpointInterval >= 3600, "Interval too short"); // Min 1 hour

        // Transfer escrow from caller
        asset.safeTransferFrom(msg.sender, address(this), escrowAmount);

        // Create policy
        policyId = _createPolicy(
            perilId,
            msg.sender,
            insuredAddress,
            maxCoverage,
            durationDays,
            PremiumModel.CheckpointEscrow
        );

        // Store checkpoint data
        _checkpointPremiumData[policyId] = CheckpointPremiumData({
            escrowBalance: escrowAmount,
            accruedPremium: 0,
            lastCheckpoint: uint32(block.timestamp),
            checkpointInterval: checkpointInterval
        });

        // Allocate capital based on max coverage
        uint256 expectedLoss = _calculateExpectedLoss(perilId, maxCoverage, durationDays);
        treasuryManager.allocateToPolicy(perilId, expectedLoss);

        emit EscrowTopUp(policyId, escrowAmount, msg.sender);
    }

    // ============ PREMIUM COLLECTION ============

    /// @inheritdoc IDsrptPolicyManager
    function checkpointStreamingPolicy(uint256 policyId)
        external
        override
        onlyKeeper
        policyExists(policyId)
        policyActive(policyId)
    {
        Policy storage p = _policies[policyId];
        require(p.premiumModel == PremiumModel.StreamingBalance, "Not streaming policy");

        StreamingPremiumData storage sd = _streamingPremiumData[policyId];

        // Calculate days since last checkpoint
        uint256 daysSinceCheckpoint = (block.timestamp - sd.lastCheckpoint) / SECONDS_PER_DAY;
        if (daysSinceCheckpoint == 0) {
            revert CheckpointTooEarly(policyId, sd.lastCheckpoint, SECONDS_PER_DAY);
        }

        // Get current covered balance
        uint256 coveredBalance = _getCoveredBalance(p.insuredAddress, sd.maxCoverage);

        // Calculate daily premium
        uint256 dailyPremium = hazardEngine.quoteDailyPremium(p.perilId, coveredBalance);
        uint256 totalPremium = dailyPremium * daysSinceCheckpoint;

        // Pull premium from holder
        if (totalPremium > 0) {
            asset.safeTransferFrom(p.holder, address(treasuryManager), totalPremium);
        }

        // Update state
        sd.accruedPremium += totalPremium;
        sd.lastCheckpoint = uint32(block.timestamp);

        emit CheckpointProcessed(policyId, coveredBalance, dailyPremium, uint32(block.timestamp));
        emit PremiumCharged(policyId, totalPremium, uint32(block.timestamp));
    }

    /// @inheritdoc IDsrptPolicyManager
    function checkpointEscrowPolicy(uint256 policyId)
        external
        override
        onlyKeeper
        policyExists(policyId)
        policyActive(policyId)
    {
        Policy storage p = _policies[policyId];
        require(p.premiumModel == PremiumModel.CheckpointEscrow, "Not escrow policy");

        CheckpointPremiumData storage cd = _checkpointPremiumData[policyId];

        // Check interval
        uint256 timeSinceCheckpoint = block.timestamp - cd.lastCheckpoint;
        if (timeSinceCheckpoint < cd.checkpointInterval) {
            revert CheckpointTooEarly(policyId, cd.lastCheckpoint, cd.checkpointInterval);
        }

        // Calculate premium for period
        uint256 periods = timeSinceCheckpoint / cd.checkpointInterval;
        uint256 periodDays = (cd.checkpointInterval * periods) / SECONDS_PER_DAY;
        if (periodDays == 0) periodDays = 1;

        uint256 coveredBalance = _getCoveredBalance(p.insuredAddress, p.coverageLimit);
        uint256 premium = hazardEngine.quotePremium(p.perilId, periodDays, coveredBalance);

        // Check escrow balance
        if (premium > cd.escrowBalance) {
            revert InsufficientEscrow(policyId, premium, cd.escrowBalance);
        }

        // Deduct from escrow and transfer to treasury
        cd.escrowBalance -= premium;
        cd.accruedPremium += premium;
        cd.lastCheckpoint = uint32(block.timestamp);

        asset.safeTransfer(address(treasuryManager), premium);

        emit CheckpointProcessed(policyId, coveredBalance, premium / periodDays, uint32(block.timestamp));
        emit PremiumCharged(policyId, premium, uint32(block.timestamp));
    }

    /// @inheritdoc IDsrptPolicyManager
    function batchCheckpoint(uint256[] calldata policyIds) external override onlyKeeper {
        for (uint256 i = 0; i < policyIds.length; i++) {
            uint256 policyId = policyIds[i];
            Policy storage p = _policies[policyId];

            if (p.status != PolicyStatus.Active) continue;

            // Check if expired
            if (block.timestamp >= p.endTime) {
                _expirePolicy(policyId);
                continue;
            }

            try this._checkpointPolicyInternal(policyId) {
                // Success
            } catch {
                // Skip failed checkpoints, continue with others
            }
        }
    }

    /**
     * @notice Internal checkpoint function for batch processing
     * @param policyId Policy to checkpoint
     */
    function _checkpointPolicyInternal(uint256 policyId) external {
        require(msg.sender == address(this), "Internal only");

        Policy storage p = _policies[policyId];

        if (p.premiumModel == PremiumModel.StreamingBalance) {
            this.checkpointStreamingPolicy(policyId);
        } else if (p.premiumModel == PremiumModel.CheckpointEscrow) {
            this.checkpointEscrowPolicy(policyId);
        }
    }

    /// @inheritdoc IDsrptPolicyManager
    function topUpEscrow(uint256 policyId, uint256 amount)
        external
        override
        nonReentrant
        policyExists(policyId)
        policyActive(policyId)
    {
        Policy storage p = _policies[policyId];
        require(p.premiumModel == PremiumModel.CheckpointEscrow, "Not escrow policy");

        asset.safeTransferFrom(msg.sender, address(this), amount);
        _checkpointPremiumData[policyId].escrowBalance += amount;

        emit EscrowTopUp(policyId, amount, msg.sender);
    }

    // ============ CLAIMS & SETTLEMENT ============

    /// @inheritdoc IDsrptPolicyManager
    function submitClaim(
        uint256 policyId,
        uint256 depegBps,
        uint256 durationHours
    )
        external
        override
        nonReentrant
        policyExists(policyId)
        policyActive(policyId)
    {
        Policy storage p = _policies[policyId];

        // Only holder can submit claim
        require(msg.sender == p.holder, "Not policy holder");

        // Verify trigger was met (via oracle)
        require(_verifyTrigger(p.perilId, depegBps, durationHours), "Trigger not met");

        // Calculate payout
        uint256 payout = hazardEngine.calculatePayout(
            p.perilId,
            p.coverageLimit,
            depegBps,
            durationHours
        );

        _processClaim(policyId, depegBps, durationHours, payout);
    }

    /// @inheritdoc IDsrptPolicyManager
    function processClaimAutomatic(uint256 policyId)
        external
        override
        onlyKeeper
        policyExists(policyId)
        policyActive(policyId)
    {
        Policy storage p = _policies[policyId];

        // Get trigger data from oracle
        (uint256 depegBps, uint256 durationHours) = _getTriggerData(p.perilId);

        require(depegBps > 0 && durationHours > 0, "No active trigger");

        // Calculate payout
        uint256 payout = hazardEngine.calculatePayout(
            p.perilId,
            p.coverageLimit,
            depegBps,
            durationHours
        );

        _processClaim(policyId, depegBps, durationHours, payout);
    }

    // ============ CANCELLATION ============

    /// @inheritdoc IDsrptPolicyManager
    function cancelPolicy(uint256 policyId)
        external
        override
        nonReentrant
        policyExists(policyId)
        policyActive(policyId)
        returns (uint256 refundAmount)
    {
        Policy storage p = _policies[policyId];

        // Only holder can cancel
        require(msg.sender == p.holder, "Not policy holder");

        // Calculate pro-rated refund for fixed policies
        if (p.premiumModel == PremiumModel.FixedUpfront) {
            FixedPremiumData storage fd = _fixedPremiumData[policyId];
            uint256 totalDuration = p.endTime - p.startTime;
            uint256 elapsed = block.timestamp - p.startTime;
            uint256 remaining = totalDuration > elapsed ? totalDuration - elapsed : 0;
            refundAmount = (fd.totalPremium * remaining) / totalDuration;
        } else if (p.premiumModel == PremiumModel.CheckpointEscrow) {
            // Refund remaining escrow
            refundAmount = _checkpointPremiumData[policyId].escrowBalance;
            _checkpointPremiumData[policyId].escrowBalance = 0;
        }
        // StreamingBalance has no refund

        // Update policy status
        p.status = PolicyStatus.Cancelled;

        // Release capital from treasury
        uint256 expectedLoss = _calculateExpectedLoss(p.perilId, p.coverageLimit, (p.endTime - p.startTime) / SECONDS_PER_DAY);
        treasuryManager.releaseFromPolicy(p.perilId, expectedLoss);

        // Transfer refund
        if (refundAmount > 0) {
            asset.safeTransfer(p.holder, refundAmount);
        }

        emit PolicyCancelled(policyId, refundAmount, uint32(block.timestamp));
    }

    /// @inheritdoc IDsrptPolicyManager
    function settleExpiredPolicy(uint256 policyId)
        external
        override
        nonReentrant
        policyExists(policyId)
        returns (uint256 refundAmount)
    {
        Policy storage p = _policies[policyId];

        require(p.status == PolicyStatus.Active, "Not active");
        require(block.timestamp >= p.endTime, "Not expired");

        _expirePolicy(policyId);

        // Refund remaining escrow for checkpoint policies
        if (p.premiumModel == PremiumModel.CheckpointEscrow) {
            refundAmount = _checkpointPremiumData[policyId].escrowBalance;
            if (refundAmount > 0) {
                _checkpointPremiumData[policyId].escrowBalance = 0;
                asset.safeTransfer(p.holder, refundAmount);
            }
        }
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Set hazard engine address
     * @param _hazardEngine New hazard engine address
     */
    function setHazardEngine(address _hazardEngine) external onlyOwner {
        require(_hazardEngine != address(0), "Zero address");
        hazardEngine = IDsrptHazardEngine(_hazardEngine);
    }

    /**
     * @notice Set treasury manager address
     * @param _treasuryManager New treasury manager address
     */
    function setTreasuryManager(address _treasuryManager) external onlyOwner {
        require(_treasuryManager != address(0), "Zero address");
        treasuryManager = IDsrptTreasuryManager(_treasuryManager);
    }

    /**
     * @notice Set trigger oracle address
     * @param _triggerOracle New trigger oracle address
     */
    function setTriggerOracle(address _triggerOracle) external onlyOwner {
        triggerOracle = _triggerOracle;
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
     * @dev Validate policy parameters
     */
    function _validatePolicyParams(uint256 coverageLimit, uint32 durationDays) internal pure {
        if (coverageLimit == 0) revert InvalidCoverageLimit(coverageLimit);
        if (durationDays < MIN_DURATION_DAYS || durationDays > MAX_DURATION_DAYS) {
            revert InvalidDuration(0, durationDays);
        }
    }

    /**
     * @dev Create a new policy
     */
    function _createPolicy(
        bytes32 perilId,
        address holder,
        address insuredAddress,
        uint256 coverageLimit,
        uint32 durationDays,
        PremiumModel premiumModel
    ) internal returns (uint256 policyId) {
        policyId = _nextPolicyId++;

        uint32 startTime = uint32(block.timestamp);
        uint32 endTime = startTime + (durationDays * SECONDS_PER_DAY);

        _policies[policyId] = Policy({
            policyId: policyId,
            perilId: perilId,
            holder: holder,
            insuredAddress: insuredAddress,
            startTime: startTime,
            endTime: endTime,
            coverageLimit: coverageLimit,
            premiumModel: premiumModel,
            status: PolicyStatus.Active
        });

        // Add to holder's policies
        _policyHolderIndex[policyId] = _holderPolicies[holder].length;
        _holderPolicies[holder].push(policyId);

        emit PolicyIssued(
            policyId,
            perilId,
            holder,
            insuredAddress,
            coverageLimit,
            startTime,
            endTime,
            premiumModel
        );
    }

    /**
     * @dev Process a claim
     */
    function _processClaim(
        uint256 policyId,
        uint256 depegBps,
        uint256 durationHours,
        uint256 payout
    ) internal {
        Policy storage p = _policies[policyId];

        if (p.status == PolicyStatus.Claimed) revert AlreadyClaimed(policyId);

        // Update policy status
        p.status = PolicyStatus.Claimed;

        // Store claim data
        _claims[policyId] = Claim({
            policyId: policyId,
            claimedAt: uint32(block.timestamp),
            depegBps: depegBps,
            durationHours: durationHours,
            payoutAmount: payout
        });

        // Pay claim via treasury (waterfall)
        treasuryManager.payClaim(policyId, payout);

        // Transfer payout to holder
        asset.safeTransfer(p.holder, payout);

        // Release remaining capital
        uint256 expectedLoss = _calculateExpectedLoss(p.perilId, p.coverageLimit, (p.endTime - p.startTime) / SECONDS_PER_DAY);
        if (expectedLoss > payout) {
            treasuryManager.releaseFromPolicy(p.perilId, expectedLoss - payout);
        }

        emit PolicyClaimed(policyId, depegBps, durationHours, payout, uint32(block.timestamp));
    }

    /**
     * @dev Expire a policy
     */
    function _expirePolicy(uint256 policyId) internal {
        Policy storage p = _policies[policyId];
        p.status = PolicyStatus.Expired;

        // Release capital from treasury
        uint256 expectedLoss = _calculateExpectedLoss(p.perilId, p.coverageLimit, (p.endTime - p.startTime) / SECONDS_PER_DAY);
        treasuryManager.releaseFromPolicy(p.perilId, expectedLoss);

        emit PolicyExpired(policyId, uint32(block.timestamp));
    }

    /**
     * @dev Calculate expected loss for capital allocation
     */
    function _calculateExpectedLoss(
        bytes32 perilId,
        uint256 coverage,
        uint256 durationDays
    ) internal view returns (uint256) {
        // Get detailed premium quote which includes base expected loss
        (uint256 baseEL, , , ) = hazardEngine.quotePremiumDetailed(perilId, durationDays, coverage);
        return baseEL;
    }

    /**
     * @dev Get covered balance for insured address
     */
    function _getCoveredBalance(address insuredAddress, uint256 maxCoverage) internal view returns (uint256) {
        uint256 balance = asset.balanceOf(insuredAddress);
        return balance > maxCoverage ? maxCoverage : balance;
    }

    /**
     * @dev Calculate streaming premium for a number of days
     */
    function _calculateStreamingPremium(uint256 policyId, uint256 days_) internal view returns (uint256) {
        Policy storage p = _policies[policyId];
        StreamingPremiumData storage sd = _streamingPremiumData[policyId];

        uint256 coveredBalance = _getCoveredBalance(p.insuredAddress, sd.maxCoverage);
        uint256 dailyPremium = hazardEngine.quoteDailyPremium(p.perilId, coveredBalance);

        return dailyPremium * days_;
    }

    /**
     * @dev Calculate checkpoint premium
     */
    function _calculateCheckpointPremium(uint256 policyId, uint256 periods) internal view returns (uint256) {
        Policy storage p = _policies[policyId];
        CheckpointPremiumData storage cd = _checkpointPremiumData[policyId];

        uint256 periodDays = (cd.checkpointInterval * periods) / SECONDS_PER_DAY;
        if (periodDays == 0) periodDays = 1;

        uint256 coveredBalance = _getCoveredBalance(p.insuredAddress, p.coverageLimit);
        return hazardEngine.quotePremium(p.perilId, periodDays, coveredBalance);
    }

    /**
     * @dev Verify trigger was met via oracle
     */
    function _verifyTrigger(
        bytes32 perilId,
        uint256 depegBps,
        uint256 durationHours
    ) internal view returns (bool) {
        if (triggerOracle == address(0)) {
            // No oracle set, trust the claim data
            // In production, this should revert
            return depegBps >= 200 && durationHours >= 1; // Min 2% depeg for 1 hour
        }

        // Call oracle to verify (interface to be implemented)
        // ITriggerOracle(triggerOracle).verifyTrigger(perilId, depegBps, durationHours)
        return true;
    }

    /**
     * @dev Get trigger data from oracle
     */
    function _getTriggerData(bytes32 /* perilId */) internal view returns (uint256 depegBps, uint256 durationHours) {
        if (triggerOracle == address(0)) {
            return (0, 0);
        }

        // Call oracle to get current trigger data
        // (depegBps, durationHours) = ITriggerOracle(triggerOracle).getTriggerData(perilId)
        return (0, 0);
    }
}
