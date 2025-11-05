// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

contract LiquidityPool {
    IERC20 public immutable asset;
    address public policyManager;

    constructor(IERC20 a) {
        asset = a;
    }

    function setPolicyManager(address pm) external {
        policyManager = pm;
    }

    function deposit(uint256 amt) external {
        require(asset.transferFrom(msg.sender, address(this), amt));
    }

    function withdraw(uint256 amt) external {
        require(asset.transfer(msg.sender, amt));
    }

    function poolAssets() external view returns (uint256) {
        return asset.balanceOf(address(this));
    }
}
