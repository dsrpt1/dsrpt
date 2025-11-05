// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IOracle {
    function latestPrice(bytes32 assetId) external view returns (int256 price, uint256 updatedAt);
    function conditionMet(bytes32 policyId) external view returns (bool);
    function setCondition(bytes32 policyId, bool met) external;
}
