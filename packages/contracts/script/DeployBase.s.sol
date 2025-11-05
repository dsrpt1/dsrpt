// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

import {HazardCurveEngine} from "../src/HazardCurveEngine.sol";
import {LiquidityPool} from "../src/LiquidityPool.sol";
import {PolicyManager} from "../src/PolicyManager.sol";
import {DepegOracleAdapter} from "../src/oracle/DepegOracleAdapter.sol";
import {IOracle} from "../src/oracle/IOracle.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol"; // 👈 this was the bad path

contract DeployBase is Script {
    function run() external {
        // read params
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

        vm.startBroadcast(pk);

        // 1) curve
        HazardCurveEngine curve = new HazardCurveEngine();

        // 2) pool
        LiquidityPool pool = new LiquidityPool(IERC20(usdc));

        // 3) policy manager
        PolicyManager pm = new PolicyManager(IERC20(usdc), pool, curve);

        // 4) oracle adapter – cast feed + set keeper
        DepegOracleAdapter adapter = new DepegOracleAdapter(
            AggregatorV3Interface(feed),
            keeper == address(0) ? deployer : keeper,
            deployer,
            depegThreshold,
            maxStale
        );

        // 5) wire oracle
        pm.setOracle(IOracle(address(adapter)));

        vm.stopBroadcast();

        console2.log("deployer:", deployer);
        console2.log("USDC:", usdc);
        console2.log("curve:", address(curve));
        console2.log("pool:", address(pool));
        console2.log("pm:", address(pm));
        console2.log("adapter:", address(adapter));
        console2.log("keeper:", keeper == address(0) ? deployer : keeper);
    }
}
