// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

import {DsrptHazardEngine} from "../src/core/DsrptHazardEngine.sol";
import {DsrptTreasuryManager} from "../src/core/DsrptTreasuryManager.sol";
import {OracleAggregator} from "../src/oracles/OracleAggregator.sol";
import {IDsrptHazardEngine} from "../src/interfaces/IDsrptHazardEngine.sol";

/**
 * @title DeployDsrpt
 * @notice Deployment script for the DSRPT Protocol on Base
 * @dev Deploys: HazardEngine, TreasuryManager, OracleAggregator
 *
 * Usage:
 *   forge script script/DeployDsrpt.s.sol:DeployDsrpt \
 *     --rpc-url https://mainnet.base.org \
 *     --broadcast \
 *     --verify
 */
contract DeployDsrpt is Script {
    // Base Mainnet addresses
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant CHAINLINK_USDC_USD = 0x2489462e64Ea205386b7b8737609B3701047a77d;

    // Default params
    bytes32 constant USDC_DEPEG_PERIL = keccak256("USDC_depeg");

    function run() external {
        // Load deployment params
        string memory root = vm.projectRoot();
        string memory path = string.concat(root, "/params/base.json");
        string memory raw = vm.readFile(path);

        address usdc = vm.parseJsonAddress(raw, ".usdc");
        address chainlinkFeed = vm.parseJsonAddress(raw, ".chainlink_usdc_usd");
        address keeper = vm.parseJsonAddress(raw, ".keeper");

        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        console2.log("=== DSRPT Protocol Deployment ===");
        console2.log("Deployer:", deployer);
        console2.log("USDC:", usdc);
        console2.log("Chainlink Feed:", chainlinkFeed);
        console2.log("Keeper:", keeper);

        vm.startBroadcast(pk);

        // 1) Deploy Oracle Aggregator
        OracleAggregator oracleAggregator = new OracleAggregator(keeper);
        console2.log("OracleAggregator:", address(oracleAggregator));

        // 2) Deploy Treasury Manager (temporary address for policy manager)
        DsrptTreasuryManager treasury = new DsrptTreasuryManager(
            IERC20(usdc),
            deployer // Will update to actual policy manager later
        );
        console2.log("TreasuryManager:", address(treasury));

        // 3) Deploy Hazard Engine
        DsrptHazardEngine hazardEngine = new DsrptHazardEngine(
            keeper,                    // keeper
            address(treasury),         // treasury manager
            address(oracleAggregator)  // risk oracle
        );
        console2.log("HazardEngine:", address(hazardEngine));

        // 4) Wire contracts together
        oracleAggregator.setHazardEngine(address(hazardEngine));
        treasury.setHazardEngine(address(hazardEngine));

        // 5) Add Chainlink feed for USDC
        oracleAggregator.addFeed(
            USDC_DEPEG_PERIL,
            chainlinkFeed,
            8,     // Chainlink decimals
            10000  // Full weight
        );

        // 6) Set volatility config (12 samples at 5-min intervals = 1 hour window)
        oracleAggregator.setVolatilityConfig(
            USDC_DEPEG_PERIL,
            IDsrptOracleAdapter.VolatilityConfig({
                windowSize: 12,
                sampleInterval: 300,
                annualizationFactor1e18: 324e18 // sqrt(365 * 24 * 12)
            })
        );

        // 7) Configure USDC_depeg curve
        _configureCurve(hazardEngine);

        // 8) Configure payout curve
        hazardEngine.setPayoutCurve(
            USDC_DEPEG_PERIL,
            IDsrptHazardEngine.PayoutCurve({
                maxDeviationBps: 3000,   // 30% max claimable deviation
                thresholdHours: 168,     // 7 days for full duration factor
                severityExponent: 2      // Convex (small deviations pay less)
            })
        );

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== Deployment Complete ===");
        console2.log("OracleAggregator:", address(oracleAggregator));
        console2.log("TreasuryManager:", address(treasury));
        console2.log("HazardEngine:", address(hazardEngine));
        console2.log("");
        console2.log("Next steps:");
        console2.log("1. Deploy PolicyManager and wire to Treasury");
        console2.log("2. Fund tranches via treasury.deposit()");
        console2.log("3. Start keeper for oracle updates");
    }

    function _configureCurve(DsrptHazardEngine engine) internal {
        // Build regime curves with realistic hazard rates
        // Calm regime: very low risk
        IDsrptHazardEngine.RegimeCurve memory calmCurve = _buildRegimeCurve(
            1e14,   // H(7) = 0.01% cumulative hazard
            5e14,   // H(30) = 0.05%
            15e14,  // H(90) = 0.15%
            2e13    // tail slope
        );

        // Volatile regime: elevated risk
        IDsrptHazardEngine.RegimeCurve memory volatileCurve = _buildRegimeCurve(
            5e14,   // H(7) = 0.05%
            25e14,  // H(30) = 0.25%
            80e14,  // H(90) = 0.80%
            1e14    // tail slope
        );

        // Crisis regime: high risk
        IDsrptHazardEngine.RegimeCurve memory crisisCurve = _buildRegimeCurve(
            20e14,  // H(7) = 0.20%
            100e14, // H(30) = 1.00%
            350e14, // H(90) = 3.50%
            5e14    // tail slope
        );

        // Build full config
        IDsrptHazardEngine.CurveConfig memory config;
        config.perilId = USDC_DEPEG_PERIL;
        config.minPremiumBps = 25;      // 0.25% minimum premium
        config.maxMultiplierBps = 30000; // 3.0x max multiplier
        config.regime = IDsrptHazardEngine.RegimeKind.Calm;
        config.regimeCurves[0] = calmCurve;
        config.regimeCurves[1] = volatileCurve;
        config.regimeCurves[2] = crisisCurve;

        engine.setCurveConfig(config);
    }

    function _buildRegimeCurve(
        uint224 h7,
        uint224 h30,
        uint224 h90,
        uint224 tailSlope
    ) internal pure returns (IDsrptHazardEngine.RegimeCurve memory curve) {
        curve.terms[0] = IDsrptHazardEngine.HazardTerm({
            tenorDays: 7,
            H1e18: h7
        });
        curve.terms[1] = IDsrptHazardEngine.HazardTerm({
            tenorDays: 30,
            H1e18: h30
        });
        curve.terms[2] = IDsrptHazardEngine.HazardTerm({
            tenorDays: 90,
            H1e18: h90
        });
        curve.tailSlope1e18 = tailSlope;
    }
}

// Import for volatility config
import {IDsrptOracleAdapter} from "../src/interfaces/IDsrptOracleAdapter.sol";
