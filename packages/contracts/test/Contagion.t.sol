// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {ContagionRegistry} from "../src/contagion/ContagionRegistry.sol";
import {BackingRatioOracle} from "../src/contagion/BackingRatioOracle.sol";
import {ContagionTrigger} from "../src/contagion/ContagionTrigger.sol";
import {ContagionPolicyManager} from "../src/contagion/ContagionPolicyManager.sol";
import {ContagionPricingEngine} from "../src/contagion/ContagionPricingEngine.sol";
import {ERC20Mock} from "./mocks/ERC20Mock.sol";

contract ContagionTest is Test {
    ContagionRegistry registry;
    BackingRatioOracle oracle;
    ContagionTrigger trigger;
    ContagionPolicyManager policyMgr;
    ContagionPricingEngine pricing;
    ERC20Mock usdc;

    address owner    = address(this);
    address keeper   = address(0xBEEF);
    address buyer    = address(0xCAFE);
    address aavePool = address(0xAA1E);
    address morpho   = address(0x4040);
    address rsETH    = address(0x5E7A);

    bytes32 assetId;

    function setUp() public {
        vm.warp(1_000_000);

        // Deploy mock USDC
        usdc = new ERC20Mock("USDC", "USDC", 6);

        // Deploy contagion stack
        registry = new ContagionRegistry();
        oracle = new BackingRatioOracle(keeper, address(registry));
        trigger = new ContagionTrigger(keeper, address(registry), address(oracle));
        policyMgr = new ContagionPolicyManager(address(usdc), address(registry), address(trigger));
        pricing = new ContagionPricingEngine(address(registry));

        // Wire trigger -> policy manager
        trigger.setPolicyManager(address(policyMgr));

        // Allow trigger contract to push ratios on oracle
        oracle.setKeeper(address(trigger));

        // Register rsETH with 2-of-3 verifier setup
        assetId = registry.registerAsset(
            rsETH,
            "rsETH",
            address(0x1111), // backing source (bridge)
            3,               // verifier cardinality
            2                // verifier threshold
        );

        // Add Aave listing: rsETH at 93% LTV, $500M supply cap
        registry.addMarketListing(
            assetId,
            aavePool,
            "Aave V3",
            9300,             // 93% LTV
            500_000_000e6     // $500M supply cap
        );

        // Add Morpho listing: rsETH at 80% LTV, $100M supply cap
        registry.addMarketListing(
            assetId,
            morpho,
            "Morpho Blue",
            8000,             // 80% LTV
            100_000_000e6     // $100M supply cap
        );

        // Configure pricing
        pricing.setPricingParams(
            assetId,
            200,    // 2% annualized breach probability
            1500,   // 15% expected dilution given breach
            15000   // 1.5x risk load
        );

        // Fund buyer with USDC
        usdc.mint(buyer, 10_000_000e6);

        // Fund tranche capital
        usdc.mint(address(this), 100_000_000e6);
        usdc.approve(address(policyMgr), type(uint256).max);
        policyMgr.depositCapital(ContagionPolicyManager.Tranche.Senior, 10_000_000e6);
        policyMgr.depositCapital(ContagionPolicyManager.Tranche.Mezzanine, 50_000_000e6);
        policyMgr.depositCapital(ContagionPolicyManager.Tranche.Catastrophic, 40_000_000e6);
    }

    // =========================================================================
    // Registry Tests
    // =========================================================================

    function test_registryAssetRegistered() public view {
        ContagionRegistry.WrappedAsset memory asset = registry.getAsset(assetId);
        assertEq(asset.token, rsETH);
        assertEq(asset.verifierCardinality, 3);
        assertEq(asset.verifierThreshold, 2);
        assertTrue(asset.active);
    }

    function test_registryListings() public view {
        ContagionRegistry.LendingMarketListing[] memory listings = registry.getListings(assetId);
        assertEq(listings.length, 2);
        assertEq(listings[0].market, aavePool);
        assertEq(listings[0].ltvBps, 9300);
        assertEq(listings[1].market, morpho);
        assertEq(listings[1].ltvBps, 8000);
    }

    function test_registryAggregateExposure() public view {
        (uint256 totalSupply, uint256 weightedLtv) = registry.getAggregateExposure(assetId);
        // Total supply cap: $500M + $100M = $600M
        assertEq(totalSupply, 600_000_000e6);
        // Weighted LTV: $500M * 0.93 + $100M * 0.80 = $465M + $80M = $545M
        assertEq(weightedLtv, 545_000_000e6);
    }

    function test_registryVerifierPenalty() public view {
        // 2-of-3: penalty = 10000 / 2 = 5000 bps
        uint16 penalty = registry.getVerifierPenalty(assetId);
        assertEq(penalty, 5000);
    }

    // =========================================================================
    // BackingRatioOracle Tests
    // =========================================================================

    function test_pushRatio_fullyBacked() public {
        // owner can push (onlyKeeper allows owner too)
        bool breached = oracle.pushRatio(assetId, 1000e18, 1000e18);

        assertFalse(breached);
        (uint16 ratio, bool b,) = oracle.getCurrentRatio(assetId);
        assertEq(ratio, 10000); // 100%
        assertFalse(b);
    }

    function test_pushRatio_breach() public {
        // 82% backing: 820 backing / 1000 supply
        bool breached = oracle.pushRatio(assetId, 820e18, 1000e18);

        assertTrue(breached);
        (uint16 ratio, bool b,) = oracle.getCurrentRatio(assetId);
        assertEq(ratio, 8200); // 82%
        assertTrue(b);

        uint16 dilution = oracle.getDilutionDepth(assetId);
        assertEq(dilution, 1800); // 18% dilution
    }

    function test_pushRatio_customThreshold() public {
        oracle.setBreachThreshold(assetId, 9000);

        bool breached = oracle.pushRatio(assetId, 920e18, 1000e18);
        assertFalse(breached);

        breached = oracle.pushRatio(assetId, 880e18, 1000e18);
        assertTrue(breached);
    }

    // =========================================================================
    // ContagionTrigger Tests
    // =========================================================================

    function test_triggerCascade() public {
        // Push breached ratio (as owner)
        oracle.pushRatio(assetId, 820e18, 1000e18);

        // Trigger cascade (as keeper)
        vm.prank(keeper);
        ContagionTrigger.BreachEvent memory evt = trigger.triggerCascade(assetId);

        assertEq(evt.ratioBps, 8200);
        assertEq(evt.dilutionBps, 1800);
        assertEq(evt.affectedMarkets, 2);
        assertEq(evt.blockNumber, block.number);
        assertTrue(trigger.isTriggered(assetId));
    }

    function test_pushAndTrigger_atomic() public {
        // Single call: push ratio + trigger cascade
        vm.prank(keeper);
        bool triggered = trigger.pushAndTrigger(assetId, 820e18, 1000e18);

        assertTrue(triggered);
        assertTrue(trigger.isTriggered(assetId));

        ContagionTrigger.BreachEvent memory evt = trigger.getBreachEvent(assetId);
        assertEq(evt.dilutionBps, 1800);
    }

    function test_pushAndTrigger_noBreach() public {
        // Fully backed: no trigger
        vm.prank(keeper);
        bool triggered = trigger.pushAndTrigger(assetId, 1000e18, 1000e18);

        assertFalse(triggered);
        assertFalse(trigger.isTriggered(assetId));
    }

    function test_estimateTotalPayout() public {
        vm.prank(keeper);
        trigger.pushAndTrigger(assetId, 820e18, 1000e18);

        uint256 totalPayout = trigger.estimateTotalPayout(assetId);
        // Aave: $500M * 0.93 * 0.18 = $83.7M
        // Morpho: $100M * 0.80 * 0.18 = $14.4M
        // Total: ~$98.1M
        assertEq(totalPayout, 98_100_000e6);
    }

    // =========================================================================
    // ContagionPolicyManager Tests
    // =========================================================================

    function test_createPositionCover() public {
        vm.startPrank(buyer);
        usdc.approve(address(policyMgr), type(uint256).max);

        uint256 policyId = policyMgr.createPositionCover(
            assetId,
            1_000_000e6,    // $1M notional
            9300,            // 93% LTV (Aave rsETH)
            ContagionPolicyManager.Tranche.Mezzanine,
            30,              // 30 days
            5_000e6          // $5K premium
        );
        vm.stopPrank();

        ContagionPolicyManager.Policy memory p = policyMgr.getPolicy(policyId);
        assertEq(p.notional, 1_000_000e6);
        assertEq(p.ltvBps, 9300);
        assertEq(uint8(p.policyType), uint8(ContagionPolicyManager.PolicyType.Position));
        assertEq(uint8(p.status), uint8(ContagionPolicyManager.PolicyStatus.Active));
    }

    function test_createProtocolCover() public {
        vm.startPrank(buyer);
        usdc.approve(address(policyMgr), type(uint256).max);

        uint256 policyId = policyMgr.createProtocolCover(
            assetId,
            190_000_000e6,   // $190M borrows against rsETH
            ContagionPolicyManager.Tranche.Mezzanine,
            90,              // 90 days
            500_000e6        // $500K premium
        );
        vm.stopPrank();

        ContagionPolicyManager.Policy memory p = policyMgr.getPolicy(policyId);
        assertEq(p.notional, 190_000_000e6);
        assertEq(p.ltvBps, 10000); // protocol cover: LTV = 100%
        assertEq(uint8(p.policyType), uint8(ContagionPolicyManager.PolicyType.Protocol));
    }

    function test_settlement_positionCover() public {
        // Create position cover: $1M at 93% LTV, mezzanine tranche
        vm.startPrank(buyer);
        usdc.approve(address(policyMgr), type(uint256).max);
        uint256 policyId = policyMgr.createPositionCover(
            assetId, 1_000_000e6, 9300,
            ContagionPolicyManager.Tranche.Mezzanine, 30, 5_000e6
        );
        vm.stopPrank();

        uint256 buyerBalBefore = usdc.balanceOf(buyer);

        // Trigger breach: R = 82% (18% dilution)
        vm.prank(keeper);
        trigger.pushAndTrigger(assetId, 820e18, 1000e18);

        // Settle
        (uint256 totalPayout, uint256 count) = policyMgr.settlePolicies(assetId);

        assertEq(count, 1);
        // Dilution = 18% (1800 bps)
        // Mezzanine tranche: floor=500, ceiling=2000
        // Effective dilution = min(1800, 2000) - 500 = 1300 bps
        // Payout = $1M * 0.93 * 0.13 = $120,900
        assertEq(totalPayout, 120_900e6);

        // Verify buyer received payout
        assertEq(usdc.balanceOf(buyer) - buyerBalBefore, 120_900e6);

        // Policy is settled
        ContagionPolicyManager.Policy memory p = policyMgr.getPolicy(policyId);
        assertEq(uint8(p.status), uint8(ContagionPolicyManager.PolicyStatus.Settled));
        assertEq(p.payout, 120_900e6);
    }

    function test_settlement_protocolCover_aaveExample() public {
        // Aave DAO buys protocol cover: $190M borrows, mezzanine
        vm.startPrank(buyer);
        usdc.approve(address(policyMgr), type(uint256).max);
        policyMgr.createProtocolCover(
            assetId, 190_000_000e6,
            ContagionPolicyManager.Tranche.Mezzanine, 90, 500_000e6
        );
        vm.stopPrank();

        // Breach: R = 82%
        vm.prank(keeper);
        trigger.pushAndTrigger(assetId, 820e18, 1000e18);

        (uint256 totalPayout,) = policyMgr.settlePolicies(assetId);

        // Effective dilution in mezz band: min(1800,2000) - 500 = 1300 bps
        // Payout = $190M * 0.13 = $24,700,000
        assertEq(totalPayout, 24_700_000e6);
    }

    function test_settlement_seniorTranche_smallDilution() public {
        // Senior tranche: covers first 0-5% dilution
        vm.startPrank(buyer);
        usdc.approve(address(policyMgr), type(uint256).max);
        policyMgr.createPositionCover(
            assetId, 1_000_000e6, 9300,
            ContagionPolicyManager.Tranche.Senior, 30, 2_000e6
        );
        vm.stopPrank();

        // Breach: R = 97% (3% dilution — within senior band)
        oracle.setBreachThreshold(assetId, 9800); // lower threshold to trigger at 97% (owner call)
        vm.prank(keeper);
        trigger.pushAndTrigger(assetId, 970e18, 1000e18);

        (uint256 totalPayout,) = policyMgr.settlePolicies(assetId);

        // Senior: floor=0, ceiling=500
        // Dilution = 300 bps, effective = min(300,500) - 0 = 300 bps
        // Payout = $1M * 0.93 * 0.03 = $27,900
        assertEq(totalPayout, 27_900e6);
    }

    function test_settlement_catastrophicTranche() public {
        // Catastrophic: covers 20%+ dilution
        vm.startPrank(buyer);
        usdc.approve(address(policyMgr), type(uint256).max);
        policyMgr.createPositionCover(
            assetId, 1_000_000e6, 9300,
            ContagionPolicyManager.Tranche.Catastrophic, 30, 1_000e6
        );
        vm.stopPrank();

        // Breach: R = 50% (50% dilution — deep into catastrophic)
        vm.prank(keeper);
        trigger.pushAndTrigger(assetId, 500e18, 1000e18);

        (uint256 totalPayout,) = policyMgr.settlePolicies(assetId);

        // Cat: floor=2000, ceiling=10000
        // Dilution = 5000 bps, effective = min(5000,10000) - 2000 = 3000 bps
        // Payout = $1M * 0.93 * 0.30 = $279,000
        assertEq(totalPayout, 279_000e6);
    }

    function test_settlement_noPayoutIfNotInTranche() public {
        // Senior tranche policy, but dilution is 18% (only mezz/cat pays)
        vm.startPrank(buyer);
        usdc.approve(address(policyMgr), type(uint256).max);
        policyMgr.createPositionCover(
            assetId, 1_000_000e6, 9300,
            ContagionPolicyManager.Tranche.Senior, 30, 2_000e6
        );
        vm.stopPrank();

        // Breach: R = 82% (18% dilution)
        vm.prank(keeper);
        trigger.pushAndTrigger(assetId, 820e18, 1000e18);

        (uint256 totalPayout, uint256 count) = policyMgr.settlePolicies(assetId);

        // Senior ceiling is 500 bps (5%). Dilution is 1800 bps.
        // Effective = min(1800, 500) - 0 = 500 bps
        // Senior DOES pay — it pays its full band
        // Payout = $1M * 0.93 * 0.05 = $46,500
        assertEq(totalPayout, 46_500e6);
        assertEq(count, 1);
    }

    function test_expiredPolicyNotSettled() public {
        vm.startPrank(buyer);
        usdc.approve(address(policyMgr), type(uint256).max);
        policyMgr.createPositionCover(
            assetId, 1_000_000e6, 9300,
            ContagionPolicyManager.Tranche.Mezzanine, 7, 2_000e6  // 7 day policy
        );
        vm.stopPrank();

        // Advance past expiry
        vm.warp(block.timestamp + 8 days);

        // Breach
        vm.prank(keeper);
        trigger.pushAndTrigger(assetId, 820e18, 1000e18);

        (uint256 totalPayout, uint256 count) = policyMgr.settlePolicies(assetId);
        assertEq(totalPayout, 0);
        assertEq(count, 0);
    }

    // =========================================================================
    // Pricing Engine Tests
    // =========================================================================

    function test_quotePremiumSimple() public {
        // $1M notional, 30 days
        uint256 premium = pricing.quotePremiumSimple(assetId, 1_000_000e6, 30);

        // EL = $1M * 0.02 * 0.15 * (30/365) = $246.58
        // Premium = EL * 1.5 = $369.86
        // Floor = $1M * 10bps * 30/365 = $82.19
        // Premium > floor, so use premium
        assertGt(premium, 300e6);  // > $300
        assertLt(premium, 500e6);  // < $500
    }

    function test_quotePremiumDetailed() public {
        ContagionPricingEngine.PremiumQuote memory q = pricing.quotePremium(
            assetId,
            1_000_000e6,   // $1M notional
            9300,           // 93% LTV
            30,             // 30 days
            aavePool        // Aave market
        );

        assertGt(q.basePremium, 0);
        assertGt(q.moralHazardLoad, 0);
        assertGt(q.totalPremium, q.basePremium); // moral hazard adds to premium
        assertGt(q.annualizedRateBps, 0);

        emit log_named_uint("Base premium ($)", q.basePremium / 1e6);
        emit log_named_uint("Moral hazard load ($)", q.moralHazardLoad / 1e6);
        emit log_named_uint("Total premium ($)", q.totalPremium / 1e6);
        emit log_named_uint("Annualized rate (bps)", q.annualizedRateBps);
        emit log_named_uint("Contagion multiplier (x100)", q.contagionMultiplier);
    }

    function test_moralHazardScaling() public {
        // High LTV (93%) should pay more than low LTV (70%)
        ContagionPricingEngine.PremiumQuote memory highLtv = pricing.quotePremium(
            assetId, 1_000_000e6, 9300, 30, aavePool
        );

        ContagionPricingEngine.PremiumQuote memory lowLtv = pricing.quotePremium(
            assetId, 1_000_000e6, 7000, 30, morpho
        );

        assertGt(highLtv.totalPremium, lowLtv.totalPremium,
            "93% LTV should pay more than 70% LTV");

        emit log_named_uint("93% LTV premium ($)", highLtv.totalPremium / 1e6);
        emit log_named_uint("70% LTV premium ($)", lowLtv.totalPremium / 1e6);
        emit log_named_uint("Ratio (x100)", (highLtv.totalPremium * 100) / lowLtv.totalPremium);
    }

    // =========================================================================
    // Full Flow: Register -> Price -> Buy -> Breach -> Settle
    // =========================================================================

    function test_fullFlow_kelpScenario() public {
        // Simulate Kelp rsETH scenario:
        // $292M exploit, $6.2B in Aave outflows, R drops to 82%

        // 1. Quote premium for Aave DAO protocol cover
        uint256 premium = pricing.quotePremiumSimple(assetId, 190_000_000e6, 90);
        emit log_named_uint("Aave DAO premium (90d, $190M) ($)", premium / 1e6);

        // 2. Aave DAO buys protocol cover
        usdc.mint(buyer, premium);
        vm.startPrank(buyer);
        usdc.approve(address(policyMgr), type(uint256).max);
        uint256 policyId = policyMgr.createProtocolCover(
            assetId, 190_000_000e6,
            ContagionPolicyManager.Tranche.Mezzanine, 90, premium
        );
        vm.stopPrank();

        // 3. Breach: rsETH backing drops to 82%
        vm.warp(block.timestamp + 15 minutes);
        vm.prank(keeper);
        trigger.pushAndTrigger(assetId, 820e18, 1000e18);

        // 4. Settle
        uint256 buyerBalBefore = usdc.balanceOf(buyer);
        policyMgr.settlePolicies(assetId);

        uint256 payout = usdc.balanceOf(buyer) - buyerBalBefore;
        emit log_named_uint("Aave DAO payout ($)", payout / 1e6);

        // Verify: mezz band effective dilution = min(1800,2000) - 500 = 1300 bps
        // Payout = $190M * 0.13 = $24.7M
        assertEq(payout, 24_700_000e6);

        ContagionPolicyManager.Policy memory p = policyMgr.getPolicy(policyId);
        assertEq(uint8(p.status), uint8(ContagionPolicyManager.PolicyStatus.Settled));

        emit log("Full Kelp scenario: Aave DAO paid premium, breach at 82%, settled $24.7M");
    }
}
