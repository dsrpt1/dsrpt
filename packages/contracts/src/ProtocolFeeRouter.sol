// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ProtocolFeeRouter
 * @notice Sits in front of policy managers to extract protocol fees from premiums.
 *
 * Fee structure:
 *   - Premium cut: 20% of every premium payment goes to protocol treasury
 *   - Management fee: 2% AUM/yr accrued from tranche capital, collected periodically
 *
 * Architecture:
 *   User pays premium → FeeRouter
 *     → 20% to protocolTreasury
 *     → 80% forwarded to PolicyManager/TreasuryManager
 *
 * For the management fee, the router tracks total AUM and allows periodic
 * collection by the protocol. 2% AUM/yr = ~0.548 bps/day.
 *
 * This contract is deployed separately from the existing policy managers,
 * which are already on-chain and immutable. Users interact with the FeeRouter
 * instead of the PolicyManager directly.
 */
contract ProtocolFeeRouter {
    using SafeERC20 for IERC20;

    // -- Events -----

    event PremiumFeeCollected(address indexed payer, uint256 totalPremium, uint256 protocolFee, uint256 forwarded);
    event ManagementFeeCollected(uint256 aum, uint256 fee, uint256 timestamp);
    event FeeParamsUpdated(uint16 premiumFeeBps, uint16 mgmtFeeBps);
    event TreasuryUpdated(address newTreasury);

    // -- State -----

    address public owner;
    address public protocolTreasury;      // wallet that receives fees
    IERC20  public immutable asset;       // USDC

    uint16  public premiumFeeBps;         // 2000 = 20%
    uint16  public mgmtFeeBps;            // 200 = 2% per year

    // Management fee tracking
    uint256 public lastMgmtFeeCollection;
    uint256 public trackedAUM;            // updated by owner/keeper

    // -- Modifiers -----

    modifier onlyOwner() {
        require(msg.sender == owner, "FeeRouter: not owner");
        _;
    }

    // -- Constructor -----

    constructor(
        address _asset,
        address _protocolTreasury,
        uint16  _premiumFeeBps,
        uint16  _mgmtFeeBps
    ) {
        require(_asset != address(0), "zero asset");
        require(_protocolTreasury != address(0), "zero treasury");
        require(_premiumFeeBps <= 5000, "premium fee > 50%");
        require(_mgmtFeeBps <= 1000, "mgmt fee > 10%");

        owner = msg.sender;
        asset = IERC20(_asset);
        protocolTreasury = _protocolTreasury;
        premiumFeeBps = _premiumFeeBps;
        mgmtFeeBps = _mgmtFeeBps;
        lastMgmtFeeCollection = block.timestamp;
    }

    // =========================================================================
    // Premium Fee Collection
    // =========================================================================

    /**
     * @notice Collect premium from user, take protocol cut, forward remainder.
     * @param payer       User paying the premium
     * @param amount      Total premium amount
     * @param destination Where to forward the net premium (PolicyManager)
     * @return netPremium Amount forwarded after fee
     */
    function collectPremium(
        address payer,
        uint256 amount,
        address destination
    ) external returns (uint256 netPremium) {
        require(amount > 0, "zero amount");
        require(destination != address(0), "zero destination");

        // Pull full premium from payer
        asset.safeTransferFrom(payer, address(this), amount);

        // Calculate protocol cut
        uint256 protocolFee = (amount * premiumFeeBps) / 10000;
        netPremium = amount - protocolFee;

        // Send fee to protocol treasury
        if (protocolFee > 0) {
            asset.safeTransfer(protocolTreasury, protocolFee);
        }

        // Forward net premium to destination (PolicyManager or TreasuryManager)
        asset.safeTransfer(destination, netPremium);

        emit PremiumFeeCollected(payer, amount, protocolFee, netPremium);
    }

    /**
     * @notice Calculate fee split for a given premium amount.
     *         View function for UI to show breakdown before purchase.
     */
    function calculateFee(uint256 premiumAmount) external view returns (
        uint256 protocolFee,
        uint256 netToPool
    ) {
        protocolFee = (premiumAmount * premiumFeeBps) / 10000;
        netToPool = premiumAmount - protocolFee;
    }

    // =========================================================================
    // Management Fee Collection (2% AUM/yr)
    // =========================================================================

    /**
     * @notice Update the tracked AUM. Called by keeper or owner.
     *         This should reflect total capital in the treasury tranches.
     */
    function updateAUM(uint256 currentAUM) external onlyOwner {
        trackedAUM = currentAUM;
    }

    /**
     * @notice Collect accrued management fee. Anyone can call.
     *         Fee = AUM × mgmtFeeBps × (elapsed / 365 days) / 10000
     */
    function collectManagementFee() external returns (uint256 fee) {
        require(trackedAUM > 0, "no AUM tracked");

        uint256 elapsed = block.timestamp - lastMgmtFeeCollection;
        require(elapsed > 0, "no time elapsed");

        // fee = AUM * mgmtFeeBps * elapsed / (10000 * 365 days)
        fee = (trackedAUM * mgmtFeeBps * elapsed) / (10000 * 365 days);

        if (fee == 0) return 0;

        lastMgmtFeeCollection = block.timestamp;

        // Transfer fee from this contract's balance (funded by premium flow)
        uint256 balance = asset.balanceOf(address(this));
        if (fee > balance) fee = balance;

        if (fee > 0) {
            asset.safeTransfer(protocolTreasury, fee);
        }

        emit ManagementFeeCollected(trackedAUM, fee, block.timestamp);
    }

    /**
     * @notice View: how much management fee has accrued since last collection.
     */
    function accruedManagementFee() external view returns (uint256 fee) {
        if (trackedAUM == 0) return 0;
        uint256 elapsed = block.timestamp - lastMgmtFeeCollection;
        fee = (trackedAUM * mgmtFeeBps * elapsed) / (10000 * 365 days);
    }

    // =========================================================================
    // Admin
    // =========================================================================

    function setFeeParams(uint16 _premiumFeeBps, uint16 _mgmtFeeBps) external onlyOwner {
        require(_premiumFeeBps <= 5000, "premium fee > 50%");
        require(_mgmtFeeBps <= 1000, "mgmt fee > 10%");
        premiumFeeBps = _premiumFeeBps;
        mgmtFeeBps = _mgmtFeeBps;
        emit FeeParamsUpdated(_premiumFeeBps, _mgmtFeeBps);
    }

    function setProtocolTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "zero treasury");
        protocolTreasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        owner = newOwner;
    }

    /**
     * @notice Recover any tokens accidentally sent to this contract.
     */
    function rescueTokens(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(protocolTreasury, amount);
    }
}
