// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {LiquidityPool} from "./LiquidityPool.sol";
import {HazardCurveEngine} from "./HazardCurveEngine.sol";
import {IOracle} from "./oracle/IOracle.sol";

contract PolicyManager is Ownable, ReentrancyGuard {
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
    address public keeper;

    uint256 public nextPolicyId;
    mapping(uint256 => Policy) public policies;

    // Default curve ID for premium calculations
    bytes32 public curveId;

    // Minimum premium as safety check (basis points)
    uint256 public minPremiumBps = 10; // 0.1%

    event PolicyCreated(uint256 indexed id, address indexed buyer, uint256 premium, uint256 payout, uint256 startTs, uint256 endTs);
    event PolicyResolved(uint256 indexed id, bool paid, uint256 payoutAmount);
    event OracleUpdated(address indexed oracle);
    event KeeperUpdated(address indexed keeper);
    event CurveIdUpdated(bytes32 indexed curveId);

    error InsufficientPremium(uint256 provided, uint256 required);
    error OracleNotSet();
    error PolicyExpired();
    error PolicyNotExpired();
    error PolicyAlreadyResolved();
    error NotKeeper();

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert NotKeeper();
        _;
    }

    constructor(
        IERC20 _asset,
        LiquidityPool _pool,
        HazardCurveEngine _curve,
        address _initialOwner,
        address _keeper,
        bytes32 _curveId
    ) Ownable(_initialOwner) {
        asset = _asset;
        pool = _pool;
        curve = _curve;
        keeper = _keeper;
        curveId = _curveId;
        nextPolicyId = 1;
    }

    /// @notice Update oracle adapter
    function setOracle(IOracle _oracle) external onlyOwner {
        oracle = _oracle;
        emit OracleUpdated(address(_oracle));
    }

    /// @notice Update keeper address
    function setKeeper(address _keeper) external onlyOwner {
        keeper = _keeper;
        emit KeeperUpdated(_keeper);
    }

    /// @notice Update curve ID for premium calculations
    function setCurveId(bytes32 _curveId) external onlyOwner {
        curveId = _curveId;
        emit CurveIdUpdated(_curveId);
    }

    /// @notice Update minimum premium basis points
    function setMinPremiumBps(uint256 _minBps) external onlyOwner {
        minPremiumBps = _minBps;
    }

    /// @notice Create a new parametric insurance policy
    /// @param premium Amount buyer is willing to pay (in asset)
    /// @param payout Maximum payout if condition is met (in asset)
    /// @param duration Policy duration in seconds
    /// @return id The newly created policy ID
    function createPolicy(
        uint256 premium,
        uint256 payout,
        uint256 duration
    ) external nonReentrant returns (uint256 id) {
        // 1. Verify premium is sufficient (via hazard curve)
        uint256 requiredPremium = curve.premiumOf(curveId, payout, duration / 1 days);
        if (premium < requiredPremium) {
            revert InsufficientPremium(premium, requiredPremium);
        }

        // 2. Also check minimum premium as safety
        uint256 minPremium = (payout * minPremiumBps) / 10_000;
        if (premium < minPremium) {
            revert InsufficientPremium(premium, minPremium);
        }

        // 3. Collect premium from buyer and send to liquidity pool
        require(
            asset.transferFrom(msg.sender, address(pool), premium),
            "Premium transfer failed"
        );

        // 4. Store policy
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

    /// @notice Resolve a policy - called by keeper after duration expires
    /// @param id Policy ID to resolve
    function resolve(uint256 id) external onlyKeeper nonReentrant {
        Policy storage p = policies[id];

        // Validate policy state
        if (p.resolved) revert PolicyAlreadyResolved();
        if (block.timestamp < p.endTs) revert PolicyNotExpired();
        if (oracle == IOracle(address(0))) revert OracleNotSet();

        // Check if condition was met via oracle
        bytes32 policyId = bytes32(id);
        bool conditionMet = oracle.conditionMet(policyId);

        // Mark as resolved
        p.resolved = true;

        // If condition met, trigger payout from pool
        if (conditionMet) {
            pool.payoutPolicy(p.buyer, p.payout);
            emit PolicyResolved(id, true, p.payout);
        } else {
            emit PolicyResolved(id, false, 0);
        }
    }

    /// @notice Get policy details
    function getPolicy(uint256 id) external view returns (Policy memory) {
        return policies[id];
    }

    /// @notice Check if policy is active (not expired and not resolved)
    function isPolicyActive(uint256 id) external view returns (bool) {
        Policy storage p = policies[id];
        return !p.resolved && block.timestamp < p.endTs;
    }

    /// @notice Get total number of policies created
    function getTotalPolicies() external view returns (uint256) {
        return nextPolicyId - 1;
    }
}
