// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {DsrptHazardEngine} from "../src/core/DsrptHazardEngine.sol";
import {IDsrptHazardEngine} from "../src/interfaces/IDsrptHazardEngine.sol";

contract OracleAdapterTest is Test {
    OracleAdapter adapter;
    DsrptHazardEngine engine;

    address owner    = address(this);
    address relayer  = address(0xBEEF);
    address treasury = address(0xCAFE);
    address usdc     = address(0xA11CE);

    bytes32 constant PERIL_ID = keccak256("USDC_depeg");

    function setUp() public {
        // Start at a realistic timestamp so warp arithmetic works
        _nextTimestamp = 1_000_000;
        vm.warp(_nextTimestamp);
        // 1. Deploy engine — owner=this, keeper=placeholder, treasury, riskOracle=placeholder
        engine = new DsrptHazardEngine(
            address(1),  // keeper placeholder
            treasury,
            address(1)   // riskOracle placeholder
        );

        // 2. Deploy adapter
        adapter = new OracleAdapter(relayer, address(engine));

        // 3. Wire roles: adapter is both riskOracle and keeper
        engine.setRiskOracle(address(adapter));
        engine.setKeeper(address(adapter));

        // 4. Configure hazard curves on the engine (owner does this)
        _configureCurves();

        // 5. Register asset on adapter
        adapter.registerAsset(usdc, PERIL_ID);
    }

    function _configureCurves() internal {
        IDsrptHazardEngine.CurveConfig memory config;
        config.perilId = PERIL_ID;
        config.minPremiumBps = 25;       // 0.25%
        config.maxMultiplierBps = 30000; // 3.0x
        config.regime = IDsrptHazardEngine.RegimeKind.Calm;

        // Calm curve
        config.regimeCurves[0].terms[0] = IDsrptHazardEngine.HazardTerm({tenorDays: 7,  H1e18: 1e14});
        config.regimeCurves[0].terms[1] = IDsrptHazardEngine.HazardTerm({tenorDays: 30, H1e18: 5e14});
        config.regimeCurves[0].terms[2] = IDsrptHazardEngine.HazardTerm({tenorDays: 90, H1e18: 15e14});
        config.regimeCurves[0].tailSlope1e18 = 2e13;

        // Volatile curve (higher hazard rates)
        config.regimeCurves[1].terms[0] = IDsrptHazardEngine.HazardTerm({tenorDays: 7,  H1e18: 5e14});
        config.regimeCurves[1].terms[1] = IDsrptHazardEngine.HazardTerm({tenorDays: 30, H1e18: 25e14});
        config.regimeCurves[1].terms[2] = IDsrptHazardEngine.HazardTerm({tenorDays: 90, H1e18: 80e14});
        config.regimeCurves[1].tailSlope1e18 = 1e14;

        // Crisis curve (highest hazard rates)
        config.regimeCurves[2].terms[0] = IDsrptHazardEngine.HazardTerm({tenorDays: 7,  H1e18: 20e14});
        config.regimeCurves[2].terms[1] = IDsrptHazardEngine.HazardTerm({tenorDays: 30, H1e18: 100e14});
        config.regimeCurves[2].terms[2] = IDsrptHazardEngine.HazardTerm({tenorDays: 90, H1e18: 350e14});
        config.regimeCurves[2].tailSlope1e18 = 5e14;

        engine.setCurveConfig(config);
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    uint256 _nextTimestamp;

    function _advanceAndRelay(uint8 regime, uint256 confidence, uint16 pegDev, uint16 vol) internal {
        _nextTimestamp += 15 minutes;
        vm.warp(_nextTimestamp);
        vm.prank(relayer);
        adapter.updateRegime(usdc, regime, confidence, pegDev, vol);
    }

    function _relayRegime(uint8 regime, uint256 confidence, uint16 pegDev, uint16 vol) internal {
        vm.prank(relayer);
        adapter.updateRegime(usdc, regime, confidence, pegDev, vol);
    }

    // =========================================================================
    // Test: Initial state
    // =========================================================================

    function test_initialState() public view {
        (uint8 regime, uint256 confidence) = adapter.getCurrentRegime(usdc);
        assertEq(regime, 0, "should start at AMBIGUOUS");
        assertEq(confidence, 0);
        assertTrue(adapter.isPolicyIssuanceAllowed(usdc), "issuance should be allowed");
        assertTrue(adapter.isWithdrawalAllowed(usdc), "withdrawal should be allowed");

        IDsrptHazardEngine.RegimeKind engineRegime = engine.getCurrentRegime(PERIL_ID);
        assertEq(uint256(engineRegime), uint256(IDsrptHazardEngine.RegimeKind.Calm));
    }

    // =========================================================================
    // Test: AMBIGUOUS -> CONTAINED_STRESS (Calm -> Volatile, immediate)
    // =========================================================================

    function test_containedStress_escalatesToVolatile() public {
        // Quote premium BEFORE regime change (Calm)
        uint256 premiumBefore = engine.quotePremium(PERIL_ID, 30, 100_000e6);

        // Signal: contained_stress with 60% confidence, 20bps peg deviation
        _relayRegime(1, 6000, 20, 50);

        // Verify adapter state
        (uint8 regime, uint256 confidence) = adapter.getCurrentRegime(usdc);
        assertEq(regime, 1, "should be CONTAINED_STRESS");
        assertEq(confidence, 6000);
        assertEq(adapter.getPremiumMultiplier(usdc), 12500, "multiplier should be 1.25x");
        assertEq(adapter.getEscalationLevel(usdc), 1, "should be ELEVATED");
        assertTrue(adapter.isPolicyIssuanceAllowed(usdc), "issuance allowed at ELEVATED");

        // Verify engine regime changed to Volatile
        IDsrptHazardEngine.RegimeKind engineRegime = engine.getCurrentRegime(PERIL_ID);
        assertEq(uint256(engineRegime), uint256(IDsrptHazardEngine.RegimeKind.Volatile));

        // Quote premium AFTER regime change (Volatile) — should be higher
        uint256 premiumAfter = engine.quotePremium(PERIL_ID, 30, 100_000e6);
        assertGt(premiumAfter, premiumBefore, "premium should increase after escalation to Volatile");

        emit log_named_uint("Premium (Calm, 30d, $100k)", premiumBefore);
        emit log_named_uint("Premium (Volatile, 30d, $100k)", premiumAfter);
    }

    // =========================================================================
    // Test: CONTAINED_STRESS with high confidence -> ESCALATING (blocks issuance)
    // =========================================================================

    function test_highConfidenceStress_blocksIssuance() public {
        // contained_stress at 85% confidence -> ESCALATING
        _relayRegime(1, 8500, 30, 80);

        assertEq(adapter.getEscalationLevel(usdc), 2, "should be ESCALATING");
        assertFalse(adapter.isPolicyIssuanceAllowed(usdc), "issuance should be blocked at ESCALATING");
    }

    // =========================================================================
    // Test: COLLATERAL_SHOCK -> Crisis regime, 1.50x loading
    // =========================================================================

    function test_collateralShock_triggersCrisis() public {
        uint256 premiumCalm = engine.quotePremium(PERIL_ID, 30, 100_000e6);

        // collateral_shock with 75% confidence, 150bps peg deviation
        _relayRegime(3, 7500, 150, 200);

        // Adapter state
        assertEq(adapter.getPremiumMultiplier(usdc), 15000, "multiplier should be 1.50x");
        assertEq(adapter.getEscalationLevel(usdc), 2, "should be ESCALATING (>70% confidence shock)");
        assertFalse(adapter.isPolicyIssuanceAllowed(usdc), "issuance blocked at ESCALATING");

        // Engine is in Crisis
        IDsrptHazardEngine.RegimeKind engineRegime = engine.getCurrentRegime(PERIL_ID);
        assertEq(uint256(engineRegime), uint256(IDsrptHazardEngine.RegimeKind.Crisis));

        uint256 premiumCrisis = engine.quotePremium(PERIL_ID, 30, 100_000e6);
        assertGt(premiumCrisis, premiumCalm, "Crisis premium > Calm premium");

        emit log_named_uint("Premium (Calm, 30d, $100k)", premiumCalm);
        emit log_named_uint("Premium (Crisis, 30d, $100k)", premiumCrisis);
    }

    // =========================================================================
    // Test: REFLEXIVE_COLLAPSE -> halt issuance, CRITICAL escalation
    // =========================================================================

    function test_reflexiveCollapse_haltsIssuance() public {
        // reflexive_collapse with 95% confidence
        _relayRegime(4, 9500, 500, 800);

        (uint8 regime,) = adapter.getCurrentRegime(usdc);
        assertEq(regime, 4, "should be REFLEXIVE_COLLAPSE");
        assertEq(adapter.getEscalationLevel(usdc), 3, "should be CRITICAL");
        assertFalse(adapter.isPolicyIssuanceAllowed(usdc), "issuance must be halted");

        // Engine is in Crisis
        IDsrptHazardEngine.RegimeKind engineRegime = engine.getCurrentRegime(PERIL_ID);
        assertEq(uint256(engineRegime), uint256(IDsrptHazardEngine.RegimeKind.Crisis));
    }

    // =========================================================================
    // Test: 72h LP withdrawal lockup
    // =========================================================================

    function test_withdrawalLockup_72hours() public {
        assertTrue(adapter.isWithdrawalAllowed(usdc), "allowed before any transition");

        // Trigger a regime transition
        _relayRegime(1, 6000, 20, 50);

        assertFalse(adapter.isWithdrawalAllowed(usdc), "locked immediately after transition");

        uint256 remaining = adapter.timeUntilWithdrawalUnlock(usdc);
        assertEq(remaining, 72 hours, "should be 72h lockup");

        // Advance 71 hours — still locked
        vm.warp(block.timestamp + 71 hours);
        assertFalse(adapter.isWithdrawalAllowed(usdc), "still locked at 71h");

        // Advance past 72 hours — unlocked
        vm.warp(block.timestamp + 2 hours);
        assertTrue(adapter.isWithdrawalAllowed(usdc), "unlocked after 72h");
        assertEq(adapter.timeUntilWithdrawalUnlock(usdc), 0);
    }

    // =========================================================================
    // Test: Lockup resets on new transition
    // =========================================================================

    function test_lockupResetsOnNewTransition() public {
        _relayRegime(1, 6000, 20, 50);
        vm.warp(block.timestamp + 70 hours); // almost unlocked

        // New transition resets the clock
        _relayRegime(3, 7500, 150, 200);
        assertFalse(adapter.isWithdrawalAllowed(usdc), "lockup reset");
        assertEq(adapter.timeUntilWithdrawalUnlock(usdc), 72 hours);
    }

    // =========================================================================
    // Test: Full escalation cycle (Calm -> Volatile -> Crisis -> Volatile -> Calm)
    // =========================================================================

    function test_fullEscalationCycle() public {
        // 1. Start at Calm/AMBIGUOUS
        IDsrptHazardEngine.RegimeKind regime = engine.getCurrentRegime(PERIL_ID);
        assertEq(uint256(regime), 0, "starts Calm");

        // 2. Escalate to Volatile (immediate)
        _advanceAndRelay(1, 6000, 20, 50);
        regime = engine.getCurrentRegime(PERIL_ID);
        assertEq(uint256(regime), 1, "Volatile after contained_stress");

        // 3. Escalate to Crisis (immediate)
        _advanceAndRelay(3, 8000, 200, 300);
        regime = engine.getCurrentRegime(PERIL_ID);
        assertEq(uint256(regime), 2, "Crisis after collateral_shock");

        // 4. De-escalate: Crisis -> Volatile is TIMELOCKED (7 days)
        //    Adapter proposes, but it won't execute immediately
        _advanceAndRelay(1, 5000, 15, 30);

        // Engine is still in Crisis (downgrade is timelocked)
        regime = engine.getCurrentRegime(PERIL_ID);
        assertEq(uint256(regime), 2, "still Crisis - downgrade timelocked");

        // Adapter's local state reflects the signal though
        (uint8 adapterRegime,) = adapter.getCurrentRegime(usdc);
        assertEq(adapterRegime, 1, "adapter knows it's contained_stress");

        // 5. After 7 days, anyone can execute the pending transition
        _nextTimestamp += 7 days + 1;
        vm.warp(_nextTimestamp);
        engine.executeRegimeChange(PERIL_ID);
        regime = engine.getCurrentRegime(PERIL_ID);
        assertEq(uint256(regime), 1, "Volatile after timelock expires");

        emit log("Full escalation cycle completed successfully");
    }

    // =========================================================================
    // Test: Premium comparison across all regimes
    // =========================================================================

    function test_premiumComparisonAcrossRegimes() public {
        uint256 coverage = 100_000e6; // $100k USDC
        uint256 tenor = 30;           // 30 days

        // Calm premium
        uint256 calmPremium = engine.quotePremium(PERIL_ID, tenor, coverage);

        // Escalate to Volatile
        _advanceAndRelay(1, 6000, 20, 50);
        uint256 volatilePremium = engine.quotePremium(PERIL_ID, tenor, coverage);

        // Escalate to Crisis
        _advanceAndRelay(3, 8000, 200, 300);
        uint256 crisisPremium = engine.quotePremium(PERIL_ID, tenor, coverage);

        // Verify ordering: Calm < Volatile < Crisis
        assertLt(calmPremium, volatilePremium, "Calm < Volatile");
        assertLt(volatilePremium, crisisPremium, "Volatile < Crisis");

        emit log_named_uint("Calm premium (30d, $100k)",     calmPremium);
        emit log_named_uint("Volatile premium (30d, $100k)", volatilePremium);
        emit log_named_uint("Crisis premium (30d, $100k)",   crisisPremium);
        emit log_named_uint("Volatile/Calm ratio (bps)",     (volatilePremium * 10000) / calmPremium);
        emit log_named_uint("Crisis/Calm ratio (bps)",       (crisisPremium * 10000) / calmPremium);
    }

    // =========================================================================
    // Test: Only relayer can call updateRegime
    // =========================================================================

    function test_onlyRelayerCanUpdate() public {
        vm.expectRevert("OracleAdapter: not relayer");
        adapter.updateRegime(usdc, 1, 6000, 20, 50);
    }

    // =========================================================================
    // Test: Invalid regime ID reverts
    // =========================================================================

    function test_invalidRegimeReverts() public {
        vm.prank(relayer);
        vm.expectRevert("OracleAdapter: invalid regime");
        adapter.updateRegime(usdc, 5, 6000, 20, 50);
    }

    // =========================================================================
    // Test: Unregistered asset reverts
    // =========================================================================

    function test_unregisteredAssetReverts() public {
        vm.prank(relayer);
        vm.expectRevert("OracleAdapter: asset not registered");
        adapter.updateRegime(address(0xDEAD), 1, 6000, 20, 50);
    }

    // =========================================================================
    // Test: Coverage cap management
    // =========================================================================

    function test_coverageCap() public {
        adapter.setCoverageCap(usdc, 500_000e6);
        assertEq(adapter.getCoverageCap(usdc), 500_000e6);

        // Collateral shock keeps the cap
        _advanceAndRelay(3, 7000, 100, 150);
        assertEq(adapter.getCoverageCap(usdc), 500_000e6, "cap preserved during shock");

        // De-escalation clears the cap
        _advanceAndRelay(0, 3000, 5, 10);
        assertEq(adapter.getCoverageCap(usdc), 0, "cap cleared at AMBIGUOUS");
    }
}
