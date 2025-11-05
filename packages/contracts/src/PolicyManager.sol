// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {LiquidityPool} from "./LiquidityPool.sol";
import {HazardCurveEngine} from "./HazardCurveEngine.sol";
import {IOracle} from "./oracle/IOracle.sol";

contract PolicyManager {
    struct Policy {
        address buyer;
        uint256 payout;
        uint256 premium;
        uint256 startTs;
        uint256 endTs;
        bool resolved;
    }

    IERC20 public immutable asset;
    LiquidityPool public immutable pool;
    HazardCurveEngine public immutable curve;
    IOracle public oracle;

    uint256 public nextPolicyId;
    mapping(uint256 => Policy) public policies;

    event PolicyCreated(uint256 indexed id, address indexed buyer, uint256 premium, uint256 payout, uint256 startTs, uint256 endTs);
    event PolicyResolved(uint256 indexed id, bool paid);

    constructor(
        IERC20 _asset,
        LiquidityPool _pool,
        HazardCurveEngine _curve
    ) {
        asset = _asset;
        pool = _pool;
        curve = _curve;
        nextPolicyId = 1;
    }

    function setOracle(IOracle _oracle) external {
        oracle = _oracle;
    }

    // super naive: buyer calls, we store
    function createPolicy(uint256 premium, uint256 payout, uint256 duration) external returns (uint256 id) {
        // in real life: verify premium via curve, pull premium from buyer, etc.
        id = nextPolicyId++;
        policies[id] = Policy({
            buyer: msg.sender,
            payout: payout,
            premium: premium,
            startTs: block.timestamp,
            endTs: block.timestamp + duration,
            resolved: false
        });
        emit PolicyCreated(id, msg.sender, premium, payout, block.timestamp, block.timestamp + duration);
    }

    function resolve(uint256 id) external {
        Policy storage p = policies[id];
        require(!p.resolved, "already");
        // in real life: check oracle condition
        p.resolved = true;
        emit PolicyResolved(id, false);
    }
}
