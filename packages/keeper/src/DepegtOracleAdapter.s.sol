// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

interface AggregatorV3Interface {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function decimals() external view returns (uint8);
}

interface IOracle {
    function latestPrice(bytes32 assetId) external view returns (int256 price, uint256 updatedAt);
    function conditionMet(bytes32 policyId) external view returns (bool);
    function setCondition(bytes32 policyId, bool met) external;
}

/// @title DepegOracleAdapter (Ownable)
/// @notice Keeper asserts condition; contract checks live Chainlink price is below threshold.
/// Owner (your multisig/deployer) can rotate the keeper & change threshold/staleness.
contract DepegOracleAdapter is IOracle, Ownable {
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
    address public keeper;            // hot key that runs the bot
    uint256 public threshold1e8;      // e.g. 98_000_000 for $0.98
    uint256 public maxStale;          // e.g. 600 seconds

    mapping(bytes32 => bool) public resolved;
    mapping(bytes32 => bool) public condition;

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert NotKeeper();
        _;
    }

    constructor(
        AggregatorV3Interface _feed,
        address _initialOwner,
        address _keeper,
        uint256 _threshold1e8,
        uint256 _maxStale
    ) Ownable(_initialOwner) {
        if (_threshold1e8 == 0 || _threshold1e8 >= 100_000_000) revert InvalidThreshold();
        feed = _feed;
        keeper = _keeper;
        threshold1e8 = _threshold1e8;
        maxStale = _maxStale;
        emit KeeperUpdated(_keeper);
        emit ThresholdUpdated(_threshold1e8);
        emit MaxStaleUpdated(_maxStale);
    }

    // --- admin (owner) ---
    function setKeeper(address k) external onlyOwner {
        keeper = k;
        emit KeeperUpdated(k);
    }

    function setThreshold(uint256 thr1e8) external onlyOwner {
        if (thr1e8 == 0 || thr1e8 >= 100_000_000) revert InvalidThreshold();
        threshold1e8 = thr1e8;
        emit ThresholdUpdated(thr1e8);
    }

    function setMaxStale(uint256 s) external onlyOwner {
        maxStale = s;
        emit MaxStaleUpdated(s);
    }

    // --- oracle facade ---
    function latestPrice(bytes32 /*assetId*/) external view returns (int256 price, uint256 updatedAt) {
        (, int256 ans,, uint256 upd,) = feed.latestRoundData();
        uint8 d = feed.decimals();
        if (d == 8) return (ans, upd);
        if (d < 8) return (ans * int256(10 ** (8 - d)), upd);
        return (ans / int256(10 ** (d - 8)), upd);
    }

    function setCondition(bytes32 policyId, bool met) external onlyKeeper {
        if (resolved[policyId]) revert AlreadyResolved();
        (, int256 ans,, uint256 upd,) = feed.latestRoundData();
        (int256 px, uint256 ts) = _normalize(ans, upd);
        if (block.timestamp - ts > maxStale) revert FeedStale();
        if (met) {
            if (px >= int256(uint256(threshold1e8))) revert PriceNotBelowThreshold();
            condition[policyId] = true;
        } else {
            condition[policyId] = false;
        }
        resolved[policyId] = true;
        emit ConditionSet(policyId, met, px, ts);
    }

    function conditionMet(bytes32 policyId) external view returns (bool) {
        return condition[policyId];
    }

    // --- helpers ---
    function _normalize(int256 answer, uint256 updatedAt) internal view returns (int256, uint256) {
        uint8 d = feed.decimals();
        int256 normalized;
        if (d == 8) normalized = answer;
        else if (d < 8) normalized = answer * int256(10 ** (8 - d));
        else normalized = answer / int256(10 ** (d - 8));
        return (normalized, updatedAt);
    }
}
