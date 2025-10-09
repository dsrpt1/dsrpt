// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

interface AggregatorV3Interface {
    function latestRoundData() external view returns (uint80,int256,uint256,uint256,uint80);
    function decimals() external view returns (uint8);
}

contract DepegOracleAdapter is Ownable {
    error InvalidThreshold();
    error FeedStale();
    error PriceNotBelowThreshold();
    error AlreadyResolved();
    error NotKeeper();

    event KeeperUpdated(address keeper);
    event ThresholdUpdated(uint256 threshold1e8);
    event MaxStaleUpdated(uint256 maxStale);
    event ConditionSet(bytes32 indexed policyId, bool met, int256 price, uint256 updatedAt);

    AggregatorV3Interface public immutable feed;
    address public keeper;
    uint256 public threshold1e8;
    uint256 public maxStale;

    mapping(bytes32 => bool) public resolved;
    mapping(bytes32 => bool) public condition;

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert NotKeeper();
        _;
    }

    constructor(
        AggregatorV3Interface _feed,
        address _owner,
        address _keeper,
        uint256 _threshold1e8,
        uint256 _maxStale
    ) Ownable(_owner) {
        if (_threshold1e8 == 0 || _threshold1e8 >= 100_000_000) revert InvalidThreshold();
        feed = _feed;
        keeper = _keeper;
        threshold1e8 = _threshold1e8;
        maxStale = _maxStale;
        emit KeeperUpdated(_keeper);
        emit ThresholdUpdated(_threshold1e8);
        emit MaxStaleUpdated(_maxStale);
    }

    function setKeeper(address k) external onlyOwner { keeper = k; emit KeeperUpdated(k); }
    function setThreshold(uint256 thr) external onlyOwner {
        if (thr == 0 || thr >= 100_000_000) revert InvalidThreshold();
        threshold1e8 = thr; emit ThresholdUpdated(thr);
    }
    function setMaxStale(uint256 s) external onlyOwner { maxStale = s; emit MaxStaleUpdated(s); }

    function conditionMet(bytes32 policyId) external view returns (bool) { return condition[policyId]; }

    function setCondition(bytes32 policyId, bool met) external onlyKeeper {
        if (resolved[policyId]) revert AlreadyResolved();
        (, int256 ans,, uint256 upd,) = feed.latestRoundData();
        (int256 px, uint256 ts) = _normalize(ans, upd);
        if (block.timestamp - ts > maxStale) revert FeedStale();
        if (met && px >= int256(uint256(threshold1e8))) revert PriceNotBelowThreshold();
        condition[policyId] = met;
        resolved[policyId] = true;
        emit ConditionSet(policyId, met, px, ts);
    }

    function _normalize(int256 answer, uint256 updatedAt) internal view returns (int256, uint256) {
        uint8 d = feed.decimals();
        int256 n = d == 8 ? answer : (d < 8 ? answer * int256(10 ** (8 - d)) : answer / int256(10 ** (d - 8)));
        return (n, updatedAt);
    }
}
