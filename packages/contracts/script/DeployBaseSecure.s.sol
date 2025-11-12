// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

import {HazardCurveEngine} from "../src/HazardCurveEngine.sol";
import {LiquidityPool} from "../src/LiquidityPool.sol";
import {PolicyManager} from "../src/PolicyManager.sol";
import {DepegOracleAdapter} from "../src/oracle/DepegOracleAdapter.sol";
import {IOracle} from "../src/oracle/IOracle.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";

/**
 * @title DeployBaseSecure
 * @notice Deployment script for PRODUCTION-READY DSRPT contracts with security fixes
 * @dev Deploys updated contracts with:
 *      - Premium collection and payout distribution
 *      - Access controls (Ownable, onlyKeeper)
 *      - ERC-4626 vault for liquidity pool
 *      - Reentrancy guards
 */
contract DeployBaseSecure is Script {
    function run() external {
        // Read params
        string memory root = vm.projectRoot();
        string memory path = string.concat(root, "/params/base.json");
        string memory raw = vm.readFile(path);

        address usdc = vm.parseJsonAddress(raw, ".usdc");
        address feed = vm.parseJsonAddress(raw, ".chainlink_usdc_usd");
        address keeper = vm.parseJsonAddress(raw, ".keeper");
        uint256 depegThreshold = vm.parseJsonUint(raw, ".depeg_threshold_1e8");
        uint256 maxStale = vm.parseJsonUint(raw, ".max_stale_seconds");

        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        // Default curve ID for USDC depeg
        bytes32 curveId = keccak256("usdc-depeg-v1");

        vm.startBroadcast(pk);

        // 1) HazardCurveEngine (with Ownable)
        HazardCurveEngine curve = new HazardCurveEngine(deployer);

        // Set default curve (50 bps = 0.5% minimum premium)
        curve.setCurve(
            curveId,
            HazardCurveEngine.Curve({
                baseProbPerDay: 50,  // Future use
                slopePerDay: 25,     // Future use
                minPremiumBps: 50    // 0.5%
            })
        );

        // 2) LiquidityPool (ERC-4626 vault)
        LiquidityPool pool = new LiquidityPool(
            IERC20(usdc),
            deployer,              // initial owner
            "DSRPT Liquidity Pool", // ERC-20 name
            "dLP"                  // ERC-20 symbol
        );

        // 3) PolicyManager (with all security fixes)
        PolicyManager pm = new PolicyManager(
            IERC20(usdc),
            pool,
            curve,
            deployer,              // initial owner
            keeper == address(0) ? deployer : keeper,
            curveId
        );

        // 4) DepegOracleAdapter (unchanged, already secure)
        DepegOracleAdapter adapter = new DepegOracleAdapter(
            AggregatorV3Interface(feed),
            keeper == address(0) ? deployer : keeper,
            deployer,              // initial owner
            depegThreshold,
            maxStale
        );

        // 5) Wire up integrations
        pm.setOracle(IOracle(address(adapter)));
        pool.setPolicyManager(address(pm));

        vm.stopBroadcast();

        // Output deployment addresses
        console2.log("=== DSRPT Deployment (PRODUCTION-READY) ===");
        console2.log("Deployer:", deployer);
        console2.log("USDC:", usdc);
        console2.log("Curve Engine:", address(curve));
        console2.log("Liquidity Pool:", address(pool));
        console2.log("Policy Manager:", address(pm));
        console2.log("Depeg Adapter:", address(adapter));
        console2.log("Keeper:", keeper == address(0) ? deployer : keeper);
        console2.log("Curve ID:", vm.toString(curveId));
        console2.log("");
        console2.log("=== Next Steps ===");
        console2.log("1. Verify contracts on Basescan");
        console2.log("2. Fund pool with initial liquidity: pool.deposit(amount, receiver)");
        console2.log("3. Test policy creation with real USDC");
        console2.log("4. Set up keeper bot for automatic resolution");
        console2.log("5. Get professional security audit before mainnet");
    }
}
