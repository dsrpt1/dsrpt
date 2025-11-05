// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {LiquidityPool} from "./LiquidityPool.sol";
import {HazardCurveEngine} from "./HazardCurveEngine.sol";
import {IOracle} from "./interfaces/IOracle.sol";

/**
 * Minimal PolicyManager that:
 * - keeps references to asset/pool/curve
 * - exposes a public policies(uint256) getter
 * - tracks nextPolicyId
 * - allows seeding policies (createPolicy)
 * - allows swapping oracle (setOracle)
 *
 * NOTE: This is intentionally minimal to satisfy the keeper’s reads.
 * You can extend with pricing / underwriting later.
 */
contract PolicyManager {
    struct Policy {
        address owner;
        bool active;
        uint64 createdAt;
        uint64 updatedAt;
    }

    /// @notice referenced contracts (immutable, same as your current constructor)
    IERC20 public immutable asset;
    LiquidityPool public immutable pool;
    HazardCurveEngine public immutable curve;

    /// @notice oracle can be swapped (via setOracle)
    IOracle public oracle;

    /// @notice incremental id for policies; first created will be id=1
    uint256 public nextPolicyId = 1;

    /// @notice id => policy
    mapping(uint256 => Policy) public policies;

    event OracleUpdated(address indexed newOracle);
    event PolicyCreated(uint256 indexed id, address indexed owner);
    event PolicyResolved(uint256 indexed id, bool active);

    constructor(IERC20 _asset, LiquidityPool _pool, HazardCurveEngine _curve) {
        asset = _asset;
        pool = _pool;
        curve = _curve;
    }

    function setOracle(IOracle _oracle) external {
        oracle = _oracle;
        emit OracleUpdated(address(_oracle));
    }

    /// @notice seed a policy for an owner; keeper will then be able to read it
    function createPolicy(address owner_) external returns (uint256 id) {
        require(owner_ != address(0), "owner=0");

        id = nextPolicyId++;
        policies[id] = Policy({
            owner: owner_,
            active: true,
            createdAt: uint64(block.timestamp),
            updatedAt: uint64(block.timestamp)
        });

        emit PolicyCreated(id, owner_);
    }

    /// @notice a simple resolve stub to flip active; expand later as needed
    function resolve(uint256 id, bool makeInactive) external {
        Policy storage p = policies[id];
        require(p.owner != address(0), "no policy");
        if (makeInactive && p.active) {
            p.active = false;
            p.updatedAt = uint64(block.timestamp);
            emit PolicyResolved(id, false);
        } else {
            // noop or future logic
            emit PolicyResolved(id, p.active);
        }
    }
}
