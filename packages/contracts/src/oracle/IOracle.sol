// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IOracle {
    /// @notice returns true if the depeg (or whatever condition) is met
    /// you can adjust the name/signature later to match your adapter
    function isConditionMet(uint256 policyId) external view returns (bool);
}
