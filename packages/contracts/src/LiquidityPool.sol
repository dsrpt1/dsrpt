// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC4626} from "openzeppelin-contracts/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {Math} from "openzeppelin-contracts/contracts/utils/math/Math.sol";

/**
 * @title LiquidityPool
 * @notice ERC-4626 compliant vault for parametric insurance capital
 * @dev Liquidity providers deposit USDC and receive LP shares
 *      PolicyManager can trigger payouts from the pool
 */
contract LiquidityPool is ERC4626, Ownable {
    using Math for uint256;

    address public policyManager;

    event PolicyManagerUpdated(address indexed policyManager);
    event PayoutExecuted(address indexed recipient, uint256 amount, uint256 policyId);

    error NotPolicyManager();
    error PolicyManagerNotSet();
    error InsufficientPoolAssets(uint256 requested, uint256 available);

    modifier onlyPolicyManager() {
        if (msg.sender != policyManager) revert NotPolicyManager();
        _;
    }

    constructor(
        IERC20 _asset,
        address _initialOwner,
        string memory _name,
        string memory _symbol
    ) ERC4626(_asset) ERC20(_name, _symbol) Ownable(_initialOwner) {}

    /// @notice Set the PolicyManager address (only owner)
    /// @param pm Address of the PolicyManager contract
    function setPolicyManager(address pm) external onlyOwner {
        require(pm != address(0), "Invalid PM address");
        policyManager = pm;
        emit PolicyManagerUpdated(pm);
    }

    /// @notice Execute payout to policyholder (only PolicyManager)
    /// @param recipient Address to receive the payout
    /// @param amount Amount to pay out (in asset)
    /// @dev Called by PolicyManager when a policy condition is met
    function payoutPolicy(address recipient, uint256 amount) external onlyPolicyManager {
        if (policyManager == address(0)) revert PolicyManagerNotSet();

        uint256 available = totalAssets();
        if (amount > available) {
            revert InsufficientPoolAssets(amount, available);
        }

        require(IERC20(asset()).transfer(recipient, amount), "Payout transfer failed");

        // Note: policyId would need to be passed if we want to emit it
        // For now we emit 0 as placeholder
        emit PayoutExecuted(recipient, amount, 0);
    }

    /// @notice Get total assets in the pool
    /// @return Total USDC balance
    function poolAssets() external view returns (uint256) {
        return totalAssets();
    }

    /// @notice Override totalAssets to return current balance
    /// @return Total assets under management
    function totalAssets() public view virtual override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    /**
     * @dev ERC-4626 deposit/withdraw functions are inherited from OpenZeppelin
     * - deposit(assets, receiver) → deposits assets, mints shares
     * - mint(shares, receiver) → mints exact shares, deposits assets
     * - withdraw(assets, receiver, owner) → withdraws assets, burns shares
     * - redeem(shares, receiver, owner) → burns shares, withdraws assets
     *
     * All include proper share-based accounting and access control
     */
}
