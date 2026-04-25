// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {ProtocolFeeRouter} from "../src/ProtocolFeeRouter.sol";

/**
 * @title DeployFeeRouter
 * @notice Deploys the ProtocolFeeRouter for premium fee extraction.
 *
 * Fee structure:
 *   - 20% premium cut on every policy purchase
 *   - 2% AUM/yr management fee on tranche capital
 *
 * The router sits between users and the PolicyManagers.
 * Frontend routes premium payments through the FeeRouter,
 * which takes the protocol cut and forwards the rest.
 *
 * Usage:
 *   PRIVATE_KEY=0x... PROTOCOL_TREASURY=0x... \
 *   forge script script/DeployFeeRouter.s.sol:DeployFeeRouter \
 *     --rpc-url https://mainnet.base.org --broadcast
 *
 * Env vars:
 *   PRIVATE_KEY        — Deployer key
 *   PROTOCOL_TREASURY  — Wallet that receives fees (optional, defaults to deployer)
 */
contract DeployFeeRouter is Script {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address treasury = deployer;
        try vm.envAddress("PROTOCOL_TREASURY") returns (address t) {
            treasury = t;
        } catch {}

        console2.log("==========================================");
        console2.log("    Deploy Protocol Fee Router");
        console2.log("==========================================");
        console2.log("");
        console2.log("Deployer:          ", deployer);
        console2.log("Protocol Treasury: ", treasury);
        console2.log("Premium Fee:        20% (2000 bps)");
        console2.log("Management Fee:     2% AUM/yr (200 bps)");
        console2.log("");

        vm.startBroadcast(pk);

        ProtocolFeeRouter router = new ProtocolFeeRouter(
            USDC,
            treasury,
            2000,    // 20% premium cut
            200      // 2% AUM/yr management fee
        );

        vm.stopBroadcast();

        console2.log("==========================================");
        console2.log("    Fee Router Deployed");
        console2.log("==========================================");
        console2.log("");
        console2.log("  ProtocolFeeRouter:", address(router));
        console2.log("  Protocol Treasury:", treasury);
        console2.log("  Settlement Asset: ", USDC);
        console2.log("");
        console2.log("Fee flow:");
        console2.log("  User pays $1000 premium");
        console2.log("    -> $200 to protocol treasury (20%)");
        console2.log("    -> $800 to policy pool (80%)");
        console2.log("");
        console2.log("Management fee:");
        console2.log("  $10M AUM -> $200K/yr -> ~$548/day to treasury");
        console2.log("");
        console2.log("Next steps:");
        console2.log("  1. Update frontend to route premiums through FeeRouter");
        console2.log("  2. Call router.updateAUM(amount) periodically for mgmt fee");
        console2.log("  3. Call router.collectManagementFee() to collect accrued fee");
    }
}
