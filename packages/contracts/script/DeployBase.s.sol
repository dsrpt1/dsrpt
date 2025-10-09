// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

import {HazardCurveEngine} from "../src/HazardCurveEngine.sol";
import {LiquidityPool} from "../src/LiquidityPool.sol";
import {PolicyManager} from "../src/PolicyManager.sol";
import {DepegOracleAdapter} from "../src/oracle/DepegOracleAdapter.sol";

interface AggregatorV3Interface {
    function latestRoundData() external view returns (uint80,int256,uint256,uint256,uint80);
    function decimals() external view returns (uint8);
}

contract DeployBase is Script {
    function run() external {
        string memory path = string.concat(vm.projectRoot(), "/packages/contracts/params/base.json");
        bytes memory raw = vm.readFile(path);

        address USDC   = vm.parseJsonAddress(raw, ".usdc");
        address FEED   = vm.parseJsonAddress(raw, ".chainlink_usdc_usd");
        address KEEPER = vm.parseJsonAddress(raw, ".keeper");
        uint256 THR    = vm.parseJsonUint(raw, ".depeg_threshold_1e8");
        uint256 STALE  = vm.parseJsonUint(raw, ".max_stale_seconds");

        uint256 pk = vm.envUint("PRIVATE_KEY");
        address DEPLOYER = vm.addr(pk);

        vm.startBroadcast(pk);

        HazardCurveEngine curve = new HazardCurveEngine();
        LiquidityPool pool = new LiquidityPool(IERC20(USDC));
        PolicyManager pm = new PolicyManager(IERC20(USDC), pool, curve);

        address keeperToUse = (KEEPER == address(0)) ? DEPLOYER : KEEPER;

        DepegOracleAdapter adapter = new DepegOracleAdapter(
            AggregatorV3Interface(FEED),
            DEPLOYER,
            keeperToUse,
            THR,
            STALE
        );

        pm.setOracle(adapter);
        pool.setPolicyManager(address(pm));

        bytes32 productId = keccak256("USDC_DEPEG_98_24H");
        HazardCurveEngine.Curve memory c = HazardCurveEngine.Curve({
            baseProbPerDay: vm.parseJsonUint(raw, ".curve.baseProbPerDay"),
            slopePerDay: vm.parseJsonUint(raw, ".curve.slopePerDay"),
            minPremiumBps: vm.parseJsonUint(raw, ".curve.minPremiumBps")
        });
        curve.setCurve(productId, c);

        vm.stopBroadcast();

        console2.log("deployer:", DEPLOYER);
        console2.log("curve:", address(curve));
        console2.log("pool:", address(pool));
        console2.log("pm:", address(pm));
        console2.log("adapter:", address(adapter));
        console2.log("keeper:", keeperToUse);
    }
}
