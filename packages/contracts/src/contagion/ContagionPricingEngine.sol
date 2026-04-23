// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ContagionRegistry} from "./ContagionRegistry.sol";

/**
 * @title ContagionPricingEngine
 * @notice Prices contagion cover using the contagion multiplier (PRG-CM).
 *
 * Expected loss:
 *   EL = P(primary_breach) × E[dilution_depth | breach] × affected_notional
 *
 * Premium:
 *   Premium = EL × risk_load × moral_hazard_adjustment
 *
 * Contagion multiplier (PRG-CM):
 *   CM = rehypothecation_depth × LTV_aggression × verifier_penalty
 *
 * Empirical contagion ratios:
 *   Kelp rsETH: 21× (6.2B outflows / 292M exploit)
 *   Ronin:      1× (Axie siloed)
 *   Wormhole:   3-4× (limited wSOL rehypothecation)
 *   Multichain: 8×
 *   Nomad:      2×
 *
 * Moral hazard adjustment:
 *   Premium scales with LTV × supply_cap × verifier_cardinality_penalty.
 *   A protocol listing at 93% LTV on 1-of-1 DVN pays dramatically more
 *   than one listing at 70% LTV on 3-of-5.
 */
contract ContagionPricingEngine {

    // -- Structs -----

    struct PricingParams {
        uint32  breachProbBps;      // P(breach) annualized in bps (e.g., 200 = 2%)
        uint32  expectedDilutionBps;// E[dilution | breach] in bps (e.g., 1500 = 15%)
        uint16  riskLoadBps;        // risk loading factor in bps (e.g., 15000 = 1.5×)
        bool    active;
    }

    struct PremiumQuote {
        uint256 basePremium;        // EL-based premium
        uint256 moralHazardLoad;    // additional charge for LTV/verifier risk
        uint256 totalPremium;       // final premium
        uint256 contagionMultiplier;// PRG-CM value (scaled by 100)
        uint256 annualizedRateBps;  // premium / notional in bps
    }

    // -- Events -----

    event PricingParamsSet(bytes32 indexed assetId, uint32 breachProb, uint32 expectedDilution, uint16 riskLoad);

    // -- State -----

    address public owner;
    ContagionRegistry public registry;

    // assetId => pricing parameters
    mapping(bytes32 => PricingParams) public pricingParams;

    uint256 private constant BPS = 10000;
    uint256 private constant BPS2 = BPS * BPS;

    // -- Modifiers -----

    modifier onlyOwner() {
        require(msg.sender == owner, "ContagionPricingEngine: not owner");
        _;
    }

    // -- Constructor -----

    constructor(address _registry) {
        require(_registry != address(0), "zero registry");
        owner = msg.sender;
        registry = ContagionRegistry(_registry);
    }

    // =========================================================================
    // Pricing Configuration
    // =========================================================================

    function setPricingParams(
        bytes32 assetId,
        uint32  breachProbBps,
        uint32  expectedDilutionBps,
        uint16  riskLoadBps
    ) external onlyOwner {
        require(breachProbBps > 0, "zero breach prob");
        require(expectedDilutionBps > 0, "zero expected dilution");
        require(riskLoadBps >= 10000, "risk load < 1x");

        pricingParams[assetId] = PricingParams({
            breachProbBps:       breachProbBps,
            expectedDilutionBps: expectedDilutionBps,
            riskLoadBps:         riskLoadBps,
            active:              true
        });

        emit PricingParamsSet(assetId, breachProbBps, expectedDilutionBps, riskLoadBps);
    }

    // =========================================================================
    // Premium Calculation
    // =========================================================================

    /**
     * @notice Quote premium for a contagion cover policy.
     * @param assetId      Wrapped asset ID
     * @param notional     Coverage amount in settlement asset decimals
     * @param ltvBps       LTV of the position being covered (10000 for protocol cover)
     * @param durationDays Policy duration in days
     * @param market       Lending market address (for market-specific LTV penalty)
     * @return quote       Full premium breakdown
     */
    function quotePremium(
        bytes32 assetId,
        uint256 notional,
        uint16  ltvBps,
        uint256 durationDays,
        address market
    ) external view returns (PremiumQuote memory quote) {
        PricingParams memory pp = pricingParams[assetId];
        require(pp.active, "pricing not configured");

        // 1. Base expected loss (annualized)
        // EL = notional × P(breach) × E[dilution] × (duration / 365)
        uint256 baseEL = (notional * pp.breachProbBps * pp.expectedDilutionBps * durationDays)
            / (BPS2 * 365);

        // 2. Apply risk load
        uint256 basePremium = (baseEL * pp.riskLoadBps) / BPS;

        // 3. Moral hazard adjustment: LTV aggression × verifier penalty
        //    Higher LTV = more premium (listing discipline signal)
        //    Lower verifier cardinality = more premium (bridge risk)
        uint16 verifierPenalty = registry.getVerifierPenalty(assetId);

        // LTV penalty: (ltvBps / 7000)^2 — normalized to 70% LTV as baseline
        // At 70% LTV: penalty = 1.0×
        // At 93% LTV: penalty = 1.77×
        // At 50% LTV: penalty = 0.51×
        uint256 ltvPenalty = (uint256(ltvBps) * uint256(ltvBps)) / (7000 * 7000 / BPS);

        // Combined moral hazard = ltvPenalty × verifierPenalty / 10000
        uint256 moralHazardLoad = (basePremium * ltvPenalty * verifierPenalty) / (BPS * BPS);

        // 4. Contagion multiplier (PRG-CM)
        // CM = rehypothecation ratio estimate
        // For now: aggregate exposure / average listing notional
        (uint256 totalSupplyCap, uint256 weightedLtv) = registry.getAggregateExposure(assetId);
        uint256 cm = totalSupplyCap > 0 ? (weightedLtv * 100) / notional : 100; // scaled by 100

        // 5. Total premium
        uint256 totalPremium = basePremium + moralHazardLoad;

        // Floor: at least 10 bps of notional per year, pro-rated
        uint256 floorPremium = (notional * 10 * durationDays) / (BPS * 365);
        if (totalPremium < floorPremium) totalPremium = floorPremium;

        // 6. Annualized rate
        uint256 annualizedBps = (totalPremium * BPS * 365) / (notional * durationDays);

        quote = PremiumQuote({
            basePremium:        basePremium,
            moralHazardLoad:    moralHazardLoad,
            totalPremium:       totalPremium,
            contagionMultiplier: cm,
            annualizedRateBps:  annualizedBps
        });
    }

    /**
     * @notice Simple premium quote without moral hazard breakdown.
     */
    function quotePremiumSimple(
        bytes32 assetId,
        uint256 notional,
        uint256 durationDays
    ) external view returns (uint256 premium) {
        PricingParams memory pp = pricingParams[assetId];
        require(pp.active, "pricing not configured");

        uint256 baseEL = (notional * pp.breachProbBps * pp.expectedDilutionBps * durationDays)
            / (BPS2 * 365);

        premium = (baseEL * pp.riskLoadBps) / BPS;

        uint256 floorPremium = (notional * 10 * durationDays) / (BPS * 365);
        if (premium < floorPremium) premium = floorPremium;
    }

    /**
     * @notice Calculate the contagion multiplier (PRG-CM) for an asset.
     *         This is the publishable index value.
     * @return cm Contagion multiplier scaled by 100 (e.g., 2100 = 21×)
     */
    function getContagionMultiplier(bytes32 assetId) external view returns (uint256 cm) {
        (uint256 totalSupplyCap, uint256 weightedLtv) = registry.getAggregateExposure(assetId);

        ContagionRegistry.WrappedAsset memory asset = registry.getAsset(assetId);
        if (asset.token == address(0) || totalSupplyCap == 0) return 100; // 1×

        // CM = weighted LTV notional / base notional (use supply cap as proxy)
        // Adjusted by verifier penalty
        uint16 verifierPenalty = registry.getVerifierPenalty(assetId);
        cm = (weightedLtv * verifierPenalty) / (totalSupplyCap > 0 ? totalSupplyCap / 100 : 1);
    }

    // =========================================================================
    // Admin
    // =========================================================================

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        owner = newOwner;
    }
}
