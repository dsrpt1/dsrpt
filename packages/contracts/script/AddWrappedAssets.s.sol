// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {ContagionRegistry} from "../src/contagion/ContagionRegistry.sol";
import {BackingRatioOracle} from "../src/contagion/BackingRatioOracle.sol";
import {ContagionPricingEngine} from "../src/contagion/ContagionPricingEngine.sol";

/**
 * @title AddWrappedAssets
 * @notice Registers additional wrapped assets in the ContagionRegistry.
 *
 * Adds:
 *   - wstETH (Lido Wrapped Staked ETH) — 3-of-5 verifiers
 *   - cbETH  (Coinbase Wrapped Staked ETH) — centralized, 1-of-1
 *   - rETH   (Rocket Pool ETH) — decentralized, 5-of-5 (node operators)
 *   - weETH  (ether.fi Wrapped eETH) — 2-of-3 verifiers
 *
 * Each gets market listings on Aave V3 and Morpho Blue (where applicable)
 * with realistic LTV and supply cap values from current on-chain configs.
 *
 * Usage:
 *   PRIVATE_KEY=0x... forge script script/AddWrappedAssets.s.sol:AddWrappedAssets \
 *     --rpc-url https://mainnet.base.org
 *
 *   # Broadcast:
 *   PRIVATE_KEY=0x... forge script script/AddWrappedAssets.s.sol:AddWrappedAssets \
 *     --rpc-url https://mainnet.base.org --broadcast
 */
contract AddWrappedAssets is Script {
    // Deployed contagion contracts
    address constant REGISTRY = 0xcD42695b7D26e6251a12199087A0f8bE49c7e82b;
    address constant ORACLE   = 0xCe12014B3A3CA1c2D9a2cD0d23BAd94a1ead1E85;
    address constant PRICING  = 0xCe114aEB65c7df1798Da6f5071a8B6BF942dDC10;

    // Lending markets on Base
    address constant AAVE_V3_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address constant MORPHO_BLUE  = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;

    // ─── Wrapped asset addresses on Base ───

    // wstETH (Lido) — bridged via canonical Lido bridge
    address constant WSTETH = 0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452;

    // cbETH (Coinbase) — native on Base (Coinbase L2)
    address constant CBETH = 0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22;

    // rETH (Rocket Pool) — bridged via canonical bridge
    address constant RETH = 0xB6fe221Fe9EeF5aBa221c348bA20A1Bf5e73624c;

    // weETH (ether.fi) — bridged via LayerZero
    address constant WEETH = 0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        ContagionRegistry registry = ContagionRegistry(REGISTRY);
        BackingRatioOracle oracle = BackingRatioOracle(ORACLE);
        ContagionPricingEngine pricing = ContagionPricingEngine(PRICING);

        console2.log("==========================================");
        console2.log("    Add Wrapped Assets to Contagion");
        console2.log("==========================================");
        console2.log("");
        console2.log("Deployer:", deployer);
        console2.log("");

        vm.startBroadcast(pk);

        // ============================================
        // 1. wstETH — Lido Wrapped Staked ETH
        // ============================================
        console2.log("--- wstETH (Lido) ---");
        {
            // Lido has strong security: 3-of-5 multisig + timelock
            bytes32 assetId = registry.registerAsset(
                WSTETH,
                "wstETH",
                address(0), // backing source: Lido staking contract (set later)
                5,          // verifier cardinality (node operator set)
                3           // verifier threshold
            );
            console2.log("  Registered:", vm.toString(assetId));

            // Aave V3: wstETH at 79.5% LTV
            registry.addMarketListing(assetId, AAVE_V3_POOL, "Aave V3", 7950, 800_000_000e6);
            console2.log("  Aave V3: 79.5% LTV, $800M cap");

            // Morpho Blue: wstETH at ~86% LTV
            registry.addMarketListing(assetId, MORPHO_BLUE, "Morpho Blue", 8600, 200_000_000e6);
            console2.log("  Morpho Blue: 86% LTV, $200M cap");

            // Pricing: lower breach prob than rsETH (Lido more battle-tested)
            pricing.setPricingParams(assetId, 50, 1000, 12000);
            console2.log("  Pricing: 0.5% breach prob, 10% E[dilution], 1.2x load");

            oracle.setBreachThreshold(assetId, 9500);
        }

        // ============================================
        // 2. cbETH — Coinbase Wrapped Staked ETH
        // ============================================
        console2.log("--- cbETH (Coinbase) ---");
        {
            // Coinbase is centralized: effectively 1-of-1
            bytes32 assetId = registry.registerAsset(
                CBETH,
                "cbETH",
                address(0), // backing source: Coinbase staking
                1,          // verifier cardinality (centralized)
                1           // verifier threshold
            );
            console2.log("  Registered:", vm.toString(assetId));

            // Aave V3: cbETH at 74.5% LTV
            registry.addMarketListing(assetId, AAVE_V3_POOL, "Aave V3", 7450, 400_000_000e6);
            console2.log("  Aave V3: 74.5% LTV, $400M cap");

            // Pricing: higher breach prob due to centralization risk
            pricing.setPricingParams(assetId, 150, 1200, 15000);
            console2.log("  Pricing: 1.5% breach prob, 12% E[dilution], 1.5x load");

            oracle.setBreachThreshold(assetId, 9500);
        }

        // ============================================
        // 3. rETH — Rocket Pool ETH
        // ============================================
        console2.log("--- rETH (Rocket Pool) ---");
        {
            // Rocket Pool is decentralized: node operator consensus
            bytes32 assetId = registry.registerAsset(
                RETH,
                "rETH",
                address(0), // backing source: Rocket Pool deposit pool
                5,          // verifier cardinality (decentralized operators)
                5           // verifier threshold (full consensus)
            );
            console2.log("  Registered:", vm.toString(assetId));

            // Aave V3: rETH at 74.5% LTV
            registry.addMarketListing(assetId, AAVE_V3_POOL, "Aave V3", 7450, 300_000_000e6);
            console2.log("  Aave V3: 74.5% LTV, $300M cap");

            // Pricing: lowest breach prob (most decentralized)
            pricing.setPricingParams(assetId, 30, 800, 11000);
            console2.log("  Pricing: 0.3% breach prob, 8% E[dilution], 1.1x load");

            oracle.setBreachThreshold(assetId, 9500);
        }

        // ============================================
        // 4. weETH — ether.fi Wrapped eETH
        // ============================================
        console2.log("--- weETH (ether.fi) ---");
        {
            // ether.fi: bridged via LayerZero, 2-of-3 DVN
            bytes32 assetId = registry.registerAsset(
                WEETH,
                "weETH",
                address(0), // backing source: ether.fi restaking
                3,          // verifier cardinality (LayerZero DVNs)
                2           // verifier threshold
            );
            console2.log("  Registered:", vm.toString(assetId));

            // Aave V3: weETH at 77% LTV
            registry.addMarketListing(assetId, AAVE_V3_POOL, "Aave V3", 7700, 600_000_000e6);
            console2.log("  Aave V3: 77% LTV, $600M cap");

            // Morpho Blue: weETH at ~82% LTV
            registry.addMarketListing(assetId, MORPHO_BLUE, "Morpho Blue", 8200, 150_000_000e6);
            console2.log("  Morpho Blue: 82% LTV, $150M cap");

            // Pricing: similar to rsETH (restaking + bridge risk)
            pricing.setPricingParams(assetId, 180, 1500, 15000);
            console2.log("  Pricing: 1.8% breach prob, 15% E[dilution], 1.5x load");

            oracle.setBreachThreshold(assetId, 9500);
        }

        vm.stopBroadcast();

        // ============================================
        // SUMMARY
        // ============================================
        console2.log("");
        console2.log("==========================================");
        console2.log("    Wrapped Assets Registered");
        console2.log("==========================================");
        console2.log("");
        console2.log("Asset    | Verifiers | Markets    | Breach Prob | E[Dilution]");
        console2.log("---------|-----------|------------|-------------|------------");
        console2.log("rsETH    | 2-of-3    | Aave+Morph | 2.0%        | 15%        (already deployed)");
        console2.log("wstETH   | 3-of-5    | Aave+Morph | 0.5%        | 10%");
        console2.log("cbETH    | 1-of-1    | Aave       | 1.5%        | 12%");
        console2.log("rETH     | 5-of-5    | Aave       | 0.3%        | 8%");
        console2.log("weETH    | 2-of-3    | Aave+Morph | 1.8%        | 15%");
        console2.log("");
        console2.log("Premium hierarchy (cheapest to most expensive):");
        console2.log("  rETH < wstETH < cbETH < rsETH ~ weETH");
        console2.log("");
        console2.log("Moral hazard pricing ensures listing discipline:");
        console2.log("  cbETH (1-of-1) pays ~3x more than rETH (5-of-5) at same LTV");
    }
}
