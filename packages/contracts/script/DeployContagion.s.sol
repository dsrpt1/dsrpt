// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {ContagionRegistry} from "../src/contagion/ContagionRegistry.sol";
import {BackingRatioOracle} from "../src/contagion/BackingRatioOracle.sol";
import {ContagionTrigger} from "../src/contagion/ContagionTrigger.sol";
import {ContagionPolicyManager} from "../src/contagion/ContagionPolicyManager.sol";
import {ContagionPricingEngine} from "../src/contagion/ContagionPricingEngine.sol";

/**
 * @title DeployContagion
 * @notice Deploys the full contagion cover stack and registers rsETH as first asset.
 *
 * Deploys 5 contracts:
 *   1. ContagionRegistry — asset + market topology
 *   2. BackingRatioOracle — backing ratio monitoring
 *   3. ContagionTrigger — atomic cascade trigger
 *   4. ContagionPolicyManager — policy lifecycle + tranche settlement
 *   5. ContagionPricingEngine — contagion multiplier pricing
 *
 * Then registers rsETH with Aave V3 and Morpho Blue listings.
 *
 * Usage:
 *   # Dry run:
 *   PRIVATE_KEY=0x... forge script script/DeployContagion.s.sol:DeployContagion \
 *     --rpc-url https://mainnet.base.org
 *
 *   # Live:
 *   PRIVATE_KEY=0x... forge script script/DeployContagion.s.sol:DeployContagion \
 *     --rpc-url https://mainnet.base.org --broadcast --verify
 *
 * Env vars:
 *   PRIVATE_KEY     — Deployer private key
 *   KEEPER          — Keeper address for oracle updates (optional, defaults to deployer)
 */
contract DeployContagion is Script {
    // Base Mainnet addresses
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    // rsETH on Base (Kelp DAO)
    address constant RSETH = 0xC5DbB6F24F97e5Bc0cB0A48a0254D42070898b52;

    // Aave V3 Pool on Base
    address constant AAVE_V3_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;

    // Morpho Blue on Base
    address constant MORPHO_BLUE = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address keeper = deployer;
        try vm.envAddress("KEEPER") returns (address k) {
            keeper = k;
        } catch {}

        console2.log("==========================================");
        console2.log("    Contagion Cover Deployment");
        console2.log("==========================================");
        console2.log("");
        console2.log("Deployer:", deployer);
        console2.log("Keeper:  ", keeper);
        console2.log("USDC:    ", USDC);
        console2.log("rsETH:   ", RSETH);
        console2.log("");

        vm.startBroadcast(pk);

        // ============================================
        // PHASE 1: Deploy Core Contracts
        // ============================================
        console2.log("--- Phase 1: Deploy Contracts ---");

        ContagionRegistry registry = new ContagionRegistry();
        console2.log("ContagionRegistry:", address(registry));

        BackingRatioOracle oracle = new BackingRatioOracle(keeper, address(registry));
        console2.log("BackingRatioOracle:", address(oracle));

        ContagionTrigger trigger = new ContagionTrigger(keeper, address(registry), address(oracle));
        console2.log("ContagionTrigger:", address(trigger));

        ContagionPolicyManager policyMgr = new ContagionPolicyManager(
            USDC, address(registry), address(trigger)
        );
        console2.log("ContagionPolicyManager:", address(policyMgr));

        ContagionPricingEngine pricing = new ContagionPricingEngine(address(registry));
        console2.log("ContagionPricingEngine:", address(pricing));

        // ============================================
        // PHASE 2: Wire Contracts
        // ============================================
        console2.log("");
        console2.log("--- Phase 2: Wire Contracts ---");

        // Trigger needs to push ratios on oracle
        oracle.setKeeper(address(trigger));
        console2.log("  Oracle keeper -> Trigger: done");

        // Trigger references policy manager
        trigger.setPolicyManager(address(policyMgr));
        console2.log("  Trigger -> PolicyManager: done");

        // ============================================
        // PHASE 3: Register rsETH
        // ============================================
        console2.log("");
        console2.log("--- Phase 3: Register rsETH ---");

        // rsETH: bridged via Kelp DAO, assume 2-of-3 verifier setup
        bytes32 assetId = registry.registerAsset(
            RSETH,
            "rsETH",
            address(0),  // backing source TBD — set after bridge contract identified
            3,           // verifier cardinality
            2            // verifier threshold
        );
        console2.log("  rsETH registered, assetId:", vm.toString(assetId));

        // Aave V3: rsETH listed at 93% LTV, ~$500M supply cap
        registry.addMarketListing(
            assetId,
            AAVE_V3_POOL,
            "Aave V3",
            9300,              // 93% LTV
            500_000_000e6      // $500M
        );
        console2.log("  Aave V3 listing added (93% LTV, $500M cap)");

        // Morpho Blue: rsETH at ~80% LTV, ~$100M supply cap
        registry.addMarketListing(
            assetId,
            MORPHO_BLUE,
            "Morpho Blue",
            8000,              // 80% LTV
            100_000_000e6      // $100M
        );
        console2.log("  Morpho Blue listing added (80% LTV, $100M cap)");

        // ============================================
        // PHASE 4: Configure Pricing
        // ============================================
        console2.log("");
        console2.log("--- Phase 4: Configure Pricing ---");

        pricing.setPricingParams(
            assetId,
            200,     // 2% annualized breach probability
            1500,    // 15% expected dilution given breach
            15000    // 1.5x risk load
        );
        console2.log("  Pricing params set (2% breach prob, 15% E[dilution], 1.5x load)");

        // Set breach threshold to 95% (default)
        oracle.setBreachThreshold(assetId, 9500);
        console2.log("  Breach threshold: 95%");

        // ============================================
        // PHASE 5: Configure Tranches
        // ============================================
        console2.log("");
        console2.log("--- Phase 5: Configure Tranches ---");

        policyMgr.configureTranche(
            ContagionPolicyManager.Tranche.Senior,
            0, 500, 10_000_000e6  // 0-5% dilution, $10M capacity
        );
        console2.log("  Senior tranche: 0-5% dilution, $10M capacity");

        policyMgr.configureTranche(
            ContagionPolicyManager.Tranche.Mezzanine,
            500, 2000, 50_000_000e6  // 5-20% dilution, $50M capacity
        );
        console2.log("  Mezzanine tranche: 5-20% dilution, $50M capacity");

        policyMgr.configureTranche(
            ContagionPolicyManager.Tranche.Catastrophic,
            2000, 10000, 100_000_000e6  // 20-100% dilution, $100M capacity
        );
        console2.log("  Catastrophic tranche: 20-100% dilution, $100M capacity");

        vm.stopBroadcast();

        // ============================================
        // SUMMARY
        // ============================================
        console2.log("");
        console2.log("==========================================");
        console2.log("    Contagion Cover Deployed");
        console2.log("==========================================");
        console2.log("");
        console2.log("Contracts:");
        console2.log("  ContagionRegistry:     ", address(registry));
        console2.log("  BackingRatioOracle:    ", address(oracle));
        console2.log("  ContagionTrigger:      ", address(trigger));
        console2.log("  ContagionPolicyManager:", address(policyMgr));
        console2.log("  ContagionPricingEngine:", address(pricing));
        console2.log("");
        console2.log("rsETH Asset ID:", vm.toString(assetId));
        console2.log("");
        console2.log("Listings:");
        console2.log("  Aave V3:    93% LTV, $500M cap");
        console2.log("  Morpho Blue: 80% LTV, $100M cap");
        console2.log("");
        console2.log("Tranches:");
        console2.log("  Senior:       0-5% dilution,   $10M cap");
        console2.log("  Mezzanine:    5-20% dilution,   $50M cap");
        console2.log("  Catastrophic: 20-100% dilution, $100M cap");
        console2.log("");
        console2.log("Next steps:");
        console2.log("  1. Fund tranches: policyMgr.depositCapital(tranche, amount)");
        console2.log("  2. Set up keeper to monitor rsETH bridge backing ratio");
        console2.log("  3. Pitch Aave DAO: protocol cover at ~40 bps/yr on rsETH borrows");
    }
}
