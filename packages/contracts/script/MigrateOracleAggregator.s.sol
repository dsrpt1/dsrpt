// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {OracleAggregator} from "../src/oracles/OracleAggregator.sol";
import {IDsrptOracleAdapter} from "../src/interfaces/IDsrptOracleAdapter.sol";
import {IDsrptHazardEngine} from "../src/interfaces/IDsrptHazardEngine.sol";

/**
 * @title MigrateOracleAggregator
 * @notice Migration script to redeploy OracleAggregator with configurable staleness threshold
 * @dev Deploys new OracleAggregator and re-wires existing contracts
 *
 * Usage:
 *   forge script script/MigrateOracleAggregator.s.sol:MigrateOracleAggregator \
 *     --rpc-url https://mainnet.base.org \
 *     --broadcast
 */
contract MigrateOracleAggregator is Script {
    // Existing contract addresses (Base Mainnet)
    address constant HAZARD_ENGINE = 0xf6d1a5107c8723bE3526972c4171968A724c50bF;
    address constant KEEPERS_ADAPTER = 0x112B36dB8d5e0Ab86174E71737d64A51591A6868;

    // Oracle configuration
    address constant CHAINLINK_USDC_USD = 0x7e860098F58bBFC8648a4311b374B1D669a2bc6B;
    bytes32 constant USDC_DEPEG_PERIL = keccak256("USDC_depeg");

    // Keeper wallet (daemon)
    address constant KEEPER = 0x680d25d5EdF4ccEC25800e0FA5B1C28D377703C0;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        console2.log("=========================================");
        console2.log("   OracleAggregator Migration");
        console2.log("=========================================");
        console2.log("");
        console2.log("Deployer:", deployer);
        console2.log("Existing HazardEngine:", HAZARD_ENGINE);
        console2.log("");

        vm.startBroadcast(pk);

        // ============================================
        // STEP 1: Deploy new OracleAggregator
        // ============================================
        console2.log("--- Step 1: Deploy new OracleAggregator ---");

        OracleAggregator newOracle = new OracleAggregator(KEEPER);
        console2.log("New OracleAggregator:", address(newOracle));

        // ============================================
        // STEP 2: Configure new OracleAggregator
        // ============================================
        console2.log("");
        console2.log("--- Step 2: Configure OracleAggregator ---");

        // Point to HazardEngine
        newOracle.setHazardEngine(HAZARD_ENGINE);
        console2.log("Set HazardEngine");

        // Add Chainlink feed
        newOracle.addFeed(
            USDC_DEPEG_PERIL,
            CHAINLINK_USDC_USD,
            8,      // Chainlink decimals
            10000   // Full weight (100%)
        );
        console2.log("Added Chainlink USDC/USD feed");

        // Set staleness threshold to 24 hours (86400 seconds)
        newOracle.setStalenessThreshold(USDC_DEPEG_PERIL, 86400);
        console2.log("Set staleness threshold to 24 hours");

        // Set volatility config
        newOracle.setVolatilityConfig(
            USDC_DEPEG_PERIL,
            IDsrptOracleAdapter.VolatilityConfig({
                windowSize: 12,
                sampleInterval: 300,
                annualizationFactor1e18: 324e18
            })
        );
        console2.log("Set volatility config");

        // Set OracleAggregator as its own keeper (for this.recordSnapshot() calls)
        newOracle.setKeeper(address(newOracle));
        console2.log("Set self as keeper");

        // Transfer ownership to daemon wallet
        newOracle.transferOwnership(KEEPER);
        console2.log("Transferred ownership to daemon");

        vm.stopBroadcast();

        // ============================================
        // MANUAL STEPS REQUIRED
        // ============================================
        console2.log("");
        console2.log("=========================================");
        console2.log("   MANUAL STEPS REQUIRED");
        console2.log("=========================================");
        console2.log("");
        console2.log("1. Update HazardEngine keeper to new OracleAggregator:");
        console2.log("   cast send", HAZARD_ENGINE);
        console2.log("     'setKeeper(address)'", address(newOracle));
        console2.log("");
        console2.log("2. Update config.base.yaml with new address:");
        console2.log("   oracle_aggregator_address:", vm.toString(address(newOracle)));
        console2.log("");
        console2.log("3. Restart Railway deployment to pick up new address");
        console2.log("");
        console2.log("New OracleAggregator:", address(newOracle));
    }
}
