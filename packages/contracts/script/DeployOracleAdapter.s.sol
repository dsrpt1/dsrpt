// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {DsrptHazardEngine} from "../src/core/DsrptHazardEngine.sol";

/**
 * @title DeployOracleAdapter
 * @notice Deploys OracleAdapter and wires it to an existing DsrptHazardEngine.
 *
 * Prerequisites:
 *   - DsrptHazardEngine already deployed (via DeployDsrpt.s.sol)
 *   - A funded relayer EOA for the signal engine
 *
 * What this script does:
 *   1. Deploys OracleAdapter(relayer, hazardEngine)
 *   2. Grants riskOracle role on engine -> adapter
 *   3. Grants keeper role on engine -> adapter
 *   4. Registers USDC asset with its peril ID
 *
 * Usage:
 *   # Dry run (no broadcast):
 *   forge script script/DeployOracleAdapter.s.sol:DeployOracleAdapter \
 *     --rpc-url https://mainnet.base.org \
 *     --private-key $PRIVATE_KEY
 *
 *   # Live deploy:
 *   forge script script/DeployOracleAdapter.s.sol:DeployOracleAdapter \
 *     --rpc-url https://mainnet.base.org \
 *     --broadcast \
 *     --verify
 *
 * Env vars:
 *   PRIVATE_KEY           - Deployer private key (must be engine owner)
 *   HAZARD_ENGINE         - Deployed DsrptHazardEngine address
 *   SIGNAL_RELAYER        - EOA address of the signal engine relayer
 */
contract DeployOracleAdapter is Script {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    bytes32 constant USDC_DEPEG_PERIL = keccak256("USDC_depeg");

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address hazardEngineAddr = vm.envAddress("HAZARD_ENGINE");
        address signalRelayer = vm.envAddress("SIGNAL_RELAYER");

        DsrptHazardEngine engine = DsrptHazardEngine(hazardEngineAddr);

        console2.log("==========================================");
        console2.log("    OracleAdapter Deployment");
        console2.log("==========================================");
        console2.log("");
        console2.log("Deployer:       ", deployer);
        console2.log("HazardEngine:   ", hazardEngineAddr);
        console2.log("Signal Relayer: ", signalRelayer);
        console2.log("USDC:           ", USDC);
        console2.log("");

        // Verify deployer is engine owner
        address engineOwner = engine.owner();
        console2.log("Engine owner:   ", engineOwner);
        require(engineOwner == deployer, "Deployer must be engine owner");

        vm.startBroadcast(pk);

        // ============================================
        // STEP 1: Deploy OracleAdapter
        // ============================================
        OracleAdapter adapter = new OracleAdapter(signalRelayer, hazardEngineAddr);
        console2.log("");
        console2.log("OracleAdapter deployed:", address(adapter));

        // ============================================
        // STEP 2: Grant roles on DsrptHazardEngine
        // ============================================
        // OracleAdapter needs riskOracle (for proposeRegimeChange)
        // and keeper (for pushOracleState) roles
        engine.setRiskOracle(address(adapter));
        console2.log("  -> setRiskOracle: done");

        engine.setKeeper(address(adapter));
        console2.log("  -> setKeeper: done");

        // ============================================
        // STEP 3: Register USDC asset
        // ============================================
        adapter.registerAsset(USDC, USDC_DEPEG_PERIL);
        console2.log("  -> registerAsset(USDC): done");

        vm.stopBroadcast();

        // ============================================
        // SUMMARY
        // ============================================
        console2.log("");
        console2.log("==========================================");
        console2.log("    Deployment Complete");
        console2.log("==========================================");
        console2.log("");
        console2.log("  OracleAdapter: ", address(adapter));
        console2.log("  HazardEngine:  ", hazardEngineAddr);
        console2.log("  Relayer:       ", signalRelayer);
        console2.log("  USDC peril:    ", vm.toString(USDC_DEPEG_PERIL));
        console2.log("");
        console2.log("Next steps:");
        console2.log("  1. Fund relayer with ETH on Base for gas");
        console2.log("  2. Set env vars on Railway:");
        console2.log("     DSRPT_RPC_URL=<base rpc>");
        console2.log("     DSRPT_RELAYER_KEY=<relayer private key>");
        console2.log("     DSRPT_ADAPTER_ADDRESS=<adapter address>");
        console2.log("  3. Deploy signal engine to Railway");
    }
}
