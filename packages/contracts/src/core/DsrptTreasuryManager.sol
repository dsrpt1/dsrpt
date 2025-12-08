// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDsrptTreasuryManager} from "../interfaces/IDsrptTreasuryManager.sol";
import {IDsrptHazardEngine} from "../interfaces/IDsrptHazardEngine.sol";

/**
 * @title DsrptTreasuryManager
 * @notice Manages collateral pools, tranches, and capital allocations
 * @dev Implements waterfall claim payments and computes portfolio/tranche state
 *
 * Tranche Structure:
 * - Junior (0): First loss, highest yield target, highest risk
 * - Mezzanine (1): Second loss, moderate yield
 * - Senior (2): Last loss, lowest yield target, safest
 */
contract DsrptTreasuryManager is IDsrptTreasuryManager {
    using SafeERC20 for IERC20;

    // ============ STORAGE ============

    /// @notice Underlying asset (e.g., USDC)
    IERC20 public immutable asset;

    /// @notice Hazard engine for state updates
    IDsrptHazardEngine public hazardEngine;

    /// @notice Tranche configurations
    TrancheConfig[3] private _trancheConfigs;

    /// @notice Total assets in each tranche
    uint256[3] private _trancheAssets;

    /// @notice Total shares in each tranche
    uint256[3] private _trancheShares;

    /// @notice Depositor shares per tranche
    mapping(address => mapping(uint8 => uint256)) private _depositorShares;

    /// @notice Pending withdrawal requests
    mapping(address => mapping(uint8 => WithdrawalRequest)) private _withdrawalRequests;

    /// @notice Per-peril allocations
    mapping(bytes32 => PerilAllocation) private _perilAllocations;

    /// @notice Total liabilities across all perils
    uint256 private _totalLiabilities;

    /// @notice Withdrawal cooldown period
    uint32 public withdrawalCooldown = 7 days;

    /// @notice Maximum utilization before new policies blocked
    uint16 public maxUtilizationBps = 8500; // 85%

    // ============ ACCESS CONTROL ============

    /// @notice Contract owner
    address public owner;

    /// @notice Policy manager address (can allocate/release capital)
    address public policyManager;

    // ============ MODIFIERS ============

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyPolicyManager() {
        require(msg.sender == policyManager || msg.sender == owner, "Not policy manager");
        _;
    }

    modifier validTrancheId(uint8 trancheId) {
        if (trancheId > 2) revert InvalidTrancheId(trancheId);
        _;
    }

    // ============ CONSTRUCTOR ============

    constructor(IERC20 _asset, address _policyManager) {
        asset = _asset;
        policyManager = _policyManager;
        owner = msg.sender;

        // Initialize default tranche configs
        _trancheConfigs[0] = TrancheConfig({
            trancheId: 0,
            targetYieldBps: 1500,  // 15% APY target for junior
            poolShareBps: 2000,    // 20% of pool
            capacity: type(uint256).max,
            deployed: 0
        });

        _trancheConfigs[1] = TrancheConfig({
            trancheId: 1,
            targetYieldBps: 800,   // 8% APY target for mezz
            poolShareBps: 3000,    // 30% of pool
            capacity: type(uint256).max,
            deployed: 0
        });

        _trancheConfigs[2] = TrancheConfig({
            trancheId: 2,
            targetYieldBps: 400,   // 4% APY target for senior
            poolShareBps: 5000,    // 50% of pool
            capacity: type(uint256).max,
            deployed: 0
        });
    }

    // ============ VIEW FUNCTIONS ============

    /// @inheritdoc IDsrptTreasuryManager
    function getTrancheConfig(uint8 trancheId)
        external
        view
        override
        validTrancheId(trancheId)
        returns (TrancheConfig memory config)
    {
        config = _trancheConfigs[trancheId];
        config.deployed = _trancheAssets[trancheId];
    }

    /// @inheritdoc IDsrptTreasuryManager
    function getPoolStats()
        external
        view
        override
        returns (
            uint256 totalAssets,
            uint256 totalLiabilities,
            uint256 availableCapital
        )
    {
        totalAssets = _trancheAssets[0] + _trancheAssets[1] + _trancheAssets[2];
        totalLiabilities = _totalLiabilities;
        availableCapital = totalAssets > totalLiabilities ? totalAssets - totalLiabilities : 0;
    }

    /// @inheritdoc IDsrptTreasuryManager
    function getPerilAllocation(bytes32 perilId)
        external
        view
        override
        returns (PerilAllocation memory allocation)
    {
        return _perilAllocations[perilId];
    }

    /// @inheritdoc IDsrptTreasuryManager
    function getDepositorPosition(address depositor, uint8 trancheId)
        external
        view
        override
        validTrancheId(trancheId)
        returns (uint256 shares, uint256 value)
    {
        shares = _depositorShares[depositor][trancheId];
        value = _sharesToAssets(trancheId, shares);
    }

    /// @inheritdoc IDsrptTreasuryManager
    function getPendingWithdrawal(address depositor, uint8 trancheId)
        external
        view
        override
        validTrancheId(trancheId)
        returns (WithdrawalRequest memory request)
    {
        return _withdrawalRequests[depositor][trancheId];
    }

    /// @inheritdoc IDsrptTreasuryManager
    function computePortfolioState(bytes32 perilId)
        external
        view
        override
        returns (IDsrptHazardEngine.PortfolioState memory state)
    {
        uint256 totalAssets = _trancheAssets[0] + _trancheAssets[1] + _trancheAssets[2];

        // Utilization = liabilities / assets
        if (totalAssets > 0) {
            state.utilizationBps = uint16((_totalLiabilities * 10000) / totalAssets);
        }

        // Capital ratio = available / required TVaR (simplified: use liabilities as proxy)
        uint256 available = totalAssets > _totalLiabilities ? totalAssets - _totalLiabilities : 0;
        if (_totalLiabilities > 0) {
            state.capitalRatioBps = uint16((available * 10000) / _totalLiabilities);
        } else {
            state.capitalRatioBps = 20000; // Max ratio if no liabilities
        }

        // Concentration = peril exposure / total liabilities
        PerilAllocation storage pa = _perilAllocations[perilId];
        if (_totalLiabilities > 0) {
            state.perilConcentrationBps = uint16((pa.expectedLoss * 10000) / _totalLiabilities);
        }
    }

    /// @inheritdoc IDsrptTreasuryManager
    function computeTrancheState(bytes32 /* perilId */)
        external
        view
        override
        returns (IDsrptHazardEngine.TrancheState memory state)
    {
        // Calculate utilization as deployed / capacity for each tranche
        TrancheConfig storage junior = _trancheConfigs[0];
        TrancheConfig storage mezz = _trancheConfigs[1];
        TrancheConfig storage senior = _trancheConfigs[2];

        if (junior.capacity > 0) {
            state.juniorUtilBps = uint16((_trancheAssets[0] * 10000) / junior.capacity);
        }
        if (mezz.capacity > 0) {
            state.mezzUtilBps = uint16((_trancheAssets[1] * 10000) / mezz.capacity);
        }
        if (senior.capacity > 0) {
            state.seniorUtilBps = uint16((_trancheAssets[2] * 10000) / senior.capacity);
        }
    }

    // ============ LP FUNCTIONS ============

    /// @inheritdoc IDsrptTreasuryManager
    function deposit(uint8 trancheId, uint256 amount)
        external
        override
        validTrancheId(trancheId)
        returns (uint256 shares)
    {
        require(amount > 0, "Zero amount");

        TrancheConfig storage config = _trancheConfigs[trancheId];

        // Check capacity
        uint256 newTotal = _trancheAssets[trancheId] + amount;
        if (newTotal > config.capacity) {
            revert InsufficientCapacity(trancheId, amount, config.capacity - _trancheAssets[trancheId]);
        }

        // Calculate shares
        shares = _assetsToShares(trancheId, amount);

        // Transfer assets
        asset.safeTransferFrom(msg.sender, address(this), amount);

        // Update state
        _trancheAssets[trancheId] += amount;
        _trancheShares[trancheId] += shares;
        _depositorShares[msg.sender][trancheId] += shares;

        emit CapitalDeposited(msg.sender, trancheId, amount, shares);
    }

    /// @inheritdoc IDsrptTreasuryManager
    function requestWithdrawal(uint8 trancheId, uint256 shares)
        external
        override
        validTrancheId(trancheId)
    {
        require(shares > 0, "Zero shares");
        require(_depositorShares[msg.sender][trancheId] >= shares, "Insufficient shares");

        // Check no pending withdrawal
        require(_withdrawalRequests[msg.sender][trancheId].shares == 0, "Withdrawal pending");

        uint32 availableAt = uint32(block.timestamp) + withdrawalCooldown;

        _withdrawalRequests[msg.sender][trancheId] = WithdrawalRequest({
            depositor: msg.sender,
            trancheId: trancheId,
            shares: shares,
            requestedAt: uint32(block.timestamp),
            availableAt: availableAt
        });

        emit WithdrawalRequested(msg.sender, trancheId, shares, availableAt);
    }

    /// @inheritdoc IDsrptTreasuryManager
    function executeWithdrawal(uint8 trancheId)
        external
        override
        validTrancheId(trancheId)
        returns (uint256 amount)
    {
        WithdrawalRequest storage request = _withdrawalRequests[msg.sender][trancheId];

        if (request.shares == 0) {
            revert WithdrawalCooldownActive(msg.sender, 0);
        }

        if (block.timestamp < request.availableAt) {
            revert WithdrawalCooldownActive(msg.sender, request.availableAt);
        }

        uint256 shares = request.shares;
        amount = _sharesToAssets(trancheId, shares);

        // Check liquidity
        if (amount > _trancheAssets[trancheId]) {
            revert InsufficientLiquidity(amount, _trancheAssets[trancheId]);
        }

        // Update state
        _depositorShares[msg.sender][trancheId] -= shares;
        _trancheShares[trancheId] -= shares;
        _trancheAssets[trancheId] -= amount;

        // Clear request
        delete _withdrawalRequests[msg.sender][trancheId];

        // Transfer
        asset.safeTransfer(msg.sender, amount);

        emit WithdrawalExecuted(msg.sender, trancheId, shares, amount);
    }

    /// @inheritdoc IDsrptTreasuryManager
    function cancelWithdrawal(uint8 trancheId)
        external
        override
        validTrancheId(trancheId)
    {
        delete _withdrawalRequests[msg.sender][trancheId];
    }

    // ============ CLAIMS SETTLEMENT ============

    /// @inheritdoc IDsrptTreasuryManager
    function payClaim(uint256 policyId, uint256 amount)
        external
        override
        onlyPolicyManager
    {
        require(amount > 0, "Zero amount");

        uint256 remaining = amount;

        // Waterfall: Junior -> Mezz -> Senior
        for (uint8 i = 0; i < 3 && remaining > 0; i++) {
            uint256 available = _trancheAssets[i];
            uint256 deduction = remaining > available ? available : remaining;

            if (deduction > 0) {
                _trancheAssets[i] -= deduction;
                remaining -= deduction;
                emit ClaimPaidFromTranche(policyId, i, deduction);
            }
        }

        require(remaining == 0, "Insufficient funds for claim");

        // Update liabilities
        if (_totalLiabilities >= amount) {
            _totalLiabilities -= amount;
        } else {
            _totalLiabilities = 0;
        }

        // Transfer to policy manager (who will forward to policyholder)
        asset.safeTransfer(policyManager, amount);
    }

    /// @inheritdoc IDsrptTreasuryManager
    function allocateToPolicy(bytes32 perilId, uint256 expectedLoss)
        external
        override
        onlyPolicyManager
    {
        PerilAllocation storage pa = _perilAllocations[perilId];
        pa.perilId = perilId;
        pa.expectedLoss += expectedLoss;
        pa.allocatedCapital += expectedLoss; // Simple 1:1 allocation

        _totalLiabilities += expectedLoss;

        // Check utilization
        uint256 totalAssets = _trancheAssets[0] + _trancheAssets[1] + _trancheAssets[2];
        uint256 utilizationBps = totalAssets > 0 ? (_totalLiabilities * 10000) / totalAssets : 10000;

        if (utilizationBps > maxUtilizationBps) {
            revert ExcessiveUtilization(utilizationBps, maxUtilizationBps);
        }

        emit PerilAllocationUpdated(perilId, pa.allocatedCapital, pa.openExposure);
    }

    /// @inheritdoc IDsrptTreasuryManager
    function releaseFromPolicy(bytes32 perilId, uint256 expectedLoss)
        external
        override
        onlyPolicyManager
    {
        PerilAllocation storage pa = _perilAllocations[perilId];

        if (pa.expectedLoss >= expectedLoss) {
            pa.expectedLoss -= expectedLoss;
        } else {
            pa.expectedLoss = 0;
        }

        if (pa.allocatedCapital >= expectedLoss) {
            pa.allocatedCapital -= expectedLoss;
        } else {
            pa.allocatedCapital = 0;
        }

        if (_totalLiabilities >= expectedLoss) {
            _totalLiabilities -= expectedLoss;
        } else {
            _totalLiabilities = 0;
        }

        emit PerilAllocationUpdated(perilId, pa.allocatedCapital, pa.openExposure);
    }

    // ============ STATE UPDATES ============

    /// @inheritdoc IDsrptTreasuryManager
    function updatePortfolioState(bytes32 perilId) external override {
        IDsrptHazardEngine.PortfolioState memory state = this.computePortfolioState(perilId);
        hazardEngine.pushPortfolioState(perilId, state);

        emit PortfolioStateComputed(perilId, state.utilizationBps, state.capitalRatioBps);
    }

    /// @inheritdoc IDsrptTreasuryManager
    function updateTrancheState(bytes32 perilId) external override {
        IDsrptHazardEngine.TrancheState memory state = this.computeTrancheState(perilId);
        hazardEngine.pushTrancheState(perilId, state);
    }

    /// @inheritdoc IDsrptTreasuryManager
    function batchUpdateStates(bytes32[] calldata perilIds) external override {
        for (uint256 i = 0; i < perilIds.length; i++) {
            this.updatePortfolioState(perilIds[i]);
            this.updateTrancheState(perilIds[i]);
        }
    }

    // ============ GOVERNANCE FUNCTIONS ============

    /// @inheritdoc IDsrptTreasuryManager
    function setTrancheConfig(TrancheConfig calldata config)
        external
        override
        onlyOwner
        validTrancheId(config.trancheId)
    {
        _trancheConfigs[config.trancheId] = config;

        emit TrancheConfigured(
            config.trancheId,
            config.targetYieldBps,
            config.poolShareBps,
            config.capacity
        );
    }

    /// @inheritdoc IDsrptTreasuryManager
    function setWithdrawalCooldown(uint32 cooldownSeconds) external override onlyOwner {
        withdrawalCooldown = cooldownSeconds;
    }

    /// @inheritdoc IDsrptTreasuryManager
    function setMaxUtilization(uint16 _maxUtilizationBps) external override onlyOwner {
        require(_maxUtilizationBps <= 10000, "Invalid utilization");
        maxUtilizationBps = _maxUtilizationBps;
    }

    /// @inheritdoc IDsrptTreasuryManager
    function setHazardEngine(address engine) external override onlyOwner {
        require(engine != address(0), "Zero address");
        hazardEngine = IDsrptHazardEngine(engine);
    }

    /**
     * @notice Set policy manager address
     * @param _policyManager New policy manager address
     */
    function setPolicyManager(address _policyManager) external onlyOwner {
        policyManager = _policyManager;
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
     * @dev Convert assets to shares for a tranche
     */
    function _assetsToShares(uint8 trancheId, uint256 assets) internal view returns (uint256 shares) {
        uint256 totalAssets = _trancheAssets[trancheId];
        uint256 totalShares = _trancheShares[trancheId];

        if (totalShares == 0 || totalAssets == 0) {
            return assets; // 1:1 for first deposit
        }

        return (assets * totalShares) / totalAssets;
    }

    /**
     * @dev Convert shares to assets for a tranche
     */
    function _sharesToAssets(uint8 trancheId, uint256 shares) internal view returns (uint256 assets) {
        uint256 totalAssets = _trancheAssets[trancheId];
        uint256 totalShares = _trancheShares[trancheId];

        if (totalShares == 0) {
            return 0;
        }

        return (shares * totalAssets) / totalShares;
    }
}
