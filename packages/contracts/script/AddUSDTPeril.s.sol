// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {DsrptHazardEngine} from "../src/core/DsrptHazardEngine.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {OracleAggregator} from "../src/oracles/OracleAggregator.sol";
import {IDsrptHazardEngine} from "../src/interfaces/IDsrptHazardEngine.sol";
import {IDsrptOracleAdapter} from "../src/interfaces/IDsrptOracleAdapter.sol";

/**
 * @title AddUSDTPeril
 * @notice Registers USDT as a covered asset with hazard curves, oracle feed, and OracleAdapter mapping.
 *
 * What this script does:
 *   1. Configure USDT hazard curves on DsrptHazardEngine (Calm/Volatile/Crisis)
 *   2. Configure USDT payout curve on DsrptHazardEngine
 *   3. Add Chainlink USDT/USD feed to OracleAggregator
 *   4. Register USDT asset on OracleAdapter
 *
 * Prerequisites:
 *   - DsrptHazardEngine, OracleAggregator, OracleAdapter already deployed
 *   - Deployer is owner of all three contracts
 *
 * Usage:
 *   # Dry run:
 *   PRIVATE_KEY=0x... forge script script/AddUSDTPeril.s.sol:AddUSDTPeril \
 *     --rpc-url https://mainnet.base.org
 *
 *   # Live:
 *   PRIVATE_KEY=0x... forge script script/AddUSDTPeril.s.sol:AddUSDTPeril \
 *     --rpc-url https://mainnet.base.org --broadcast
 */
contract AddUSDTPeril is Script {
    // Base Mainnet addresses
    address constant USDT = 0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2;

    // Chainlink USDT/USD on Base
    // https://data.chain.link/feeds/base/mainnet/usdt-usd
    address constant CHAINLINK_USDT_USD = 0xf19d560eB8d2ADf07BD6D13ed03e1D11215721F9;

    // Deployed contract addresses (from DeployDsrpt run)
    address constant HAZARD_ENGINE    = 0x43634429c8Ff62D9808558cb150a76D32140Ba0e;
    address constant ORACLE_AGGREGATOR = 0xB203E42D84B70a60E3032F5Ed661C50cc7E9e3Cb;
    address constant ORACLE_ADAPTER   = 0x0f43Ca50CFdFb916b2782b9cF878e3F422559524;

    bytes32 constant USDT_DEPEG_PERIL = keccak256("USDT_depeg");

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        console2.log("==========================================");
        console2.log("    Add USDT Peril");
        console2.log("==========================================");
        console2.log("");
        console2.log("Deployer:         ", deployer);
        console2.log("USDT:             ", USDT);
        console2.log("Chainlink Feed:   ", CHAINLINK_USDT_USD);
        console2.log("Peril ID:         ", vm.toString(USDT_DEPEG_PERIL));
        console2.log("");

        DsrptHazardEngine engine = DsrptHazardEngine(HAZARD_ENGINE);
        OracleAggregator oracle = OracleAggregator(ORACLE_AGGREGATOR);
        OracleAdapter adapter = OracleAdapter(ORACLE_ADAPTER);

        vm.startBroadcast(pk);

        // ============================================
        // STEP 1: Configure USDT Hazard Curves
        // ============================================
        console2.log("--- Step 1: Configure Hazard Curves ---");

        // USDT has slightly higher base risk than USDC due to:
        // - Tether's reserve opacity
        // - Higher regulatory risk
        // - Historical depegs (Oct 2018, May 2022 contagion)
        // Curves are ~1.5x USDC's base rates

        // Calm: ~0.015% at 7d, ~0.22% at 90d
        IDsrptHazardEngine.RegimeCurve memory calmCurve = _buildRegimeCurve(
            15e13,  // H(7) = 0.015%
            75e13,  // H(30) = 0.075%
            22e14,  // H(90) = 0.22%
            3e13    // tail slope
        );

        // Volatile: ~0.08% at 7d, ~1.2% at 90d
        IDsrptHazardEngine.RegimeCurve memory volatileCurve = _buildRegimeCurve(
            8e14,   // H(7) = 0.08%
            38e14,  // H(30) = 0.38%
            120e14, // H(90) = 1.20%
            15e13   // tail slope
        );

        // Crisis: ~0.30% at 7d, ~5.0% at 90d
        IDsrptHazardEngine.RegimeCurve memory crisisCurve = _buildRegimeCurve(
            30e14,  // H(7) = 0.30%
            150e14, // H(30) = 1.50%
            500e14, // H(90) = 5.00%
            7e14    // tail slope
        );

        IDsrptHazardEngine.CurveConfig memory config;
        config.perilId = USDT_DEPEG_PERIL;
        config.minPremiumBps = 30;       // 0.30% min (slightly higher than USDC's 0.25%)
        config.maxMultiplierBps = 30000; // 3.0x max
        config.regime = IDsrptHazardEngine.RegimeKind.Calm;
        config.regimeCurves[0] = calmCurve;
        config.regimeCurves[1] = volatileCurve;
        config.regimeCurves[2] = crisisCurve;

        engine.setCurveConfig(config);
        console2.log("  Hazard curves configured");

        // ============================================
        // STEP 2: Configure Payout Curve
        // ============================================
        console2.log("--- Step 2: Configure Payout Curve ---");

        engine.setPayoutCurve(
            USDT_DEPEG_PERIL,
            IDsrptHazardEngine.PayoutCurve({
                maxDeviationBps: 3000,   // 30% max claimable deviation
                thresholdHours: 168,     // 7 days for full duration factor
                severityExponent: 2      // Convex (same as USDC)
            })
        );
        console2.log("  Payout curve configured");

        // ============================================
        // STEP 3: Add Chainlink USDT/USD Feed
        // ============================================
        console2.log("--- Step 3: Add Oracle Feed ---");

        oracle.addFeed(
            USDT_DEPEG_PERIL,
            CHAINLINK_USDT_USD,
            8,      // Chainlink decimals
            10000   // Full weight (100%)
        );
        console2.log("  Chainlink USDT/USD feed added");

        // Set volatility config (same as USDC)
        oracle.setVolatilityConfig(
            USDT_DEPEG_PERIL,
            IDsrptOracleAdapter.VolatilityConfig({
                windowSize: 12,
                sampleInterval: 300,
                annualizationFactor1e18: 324e18
            })
        );
        console2.log("  Volatility config set");

        // Set staleness threshold
        oracle.setStalenessThreshold(USDT_DEPEG_PERIL, 86400);
        console2.log("  Staleness threshold set (24h)");

        // ============================================
        // STEP 4: Register with OracleAdapter
        // ============================================
        console2.log("--- Step 4: Register with OracleAdapter ---");

        adapter.registerAsset(USDT, USDT_DEPEG_PERIL);
        console2.log("  USDT registered with OracleAdapter");

        vm.stopBroadcast();

        // ============================================
        // SUMMARY
        // ============================================
        console2.log("");
        console2.log("==========================================");
        console2.log("    USDT Peril Active");
        console2.log("==========================================");
        console2.log("");
        console2.log("  USDT address:    ", USDT);
        console2.log("  Peril ID:        ", vm.toString(USDT_DEPEG_PERIL));
        console2.log("  Chainlink feed:  ", CHAINLINK_USDT_USD);
        console2.log("  Min premium:      0.30%");
        console2.log("  Max multiplier:   3.0x");
        console2.log("  Calm H(30d):      0.075%");
        console2.log("  Crisis H(30d):    1.50%");
        console2.log("");
        console2.log("The signal engine already monitors USDT.");
        console2.log("On-chain regime transitions will now reprice USDT policies.");
    }

    function _buildRegimeCurve(
        uint224 h7,
        uint224 h30,
        uint224 h90,
        uint224 tailSlope
    ) internal pure returns (IDsrptHazardEngine.RegimeCurve memory curve) {
        curve.terms[0] = IDsrptHazardEngine.HazardTerm({tenorDays: 7,  H1e18: h7});
        curve.terms[1] = IDsrptHazardEngine.HazardTerm({tenorDays: 30, H1e18: h30});
        curve.terms[2] = IDsrptHazardEngine.HazardTerm({tenorDays: 90, H1e18: h90});
        curve.tailSlope1e18 = tailSlope;
    }
}
