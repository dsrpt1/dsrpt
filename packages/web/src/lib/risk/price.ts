// src/lib/risk/price.ts
// Actuarial pricing engine for parametric insurance policies

import {
  PerilSpec,
  Regime,
  hawkesEffectiveRate,
  triggerProb,
  expectedPayoutConditional,
  tvarPayoutConditional,
} from "./hazard";

export type PortfolioSide = {
  utilization: number;          // 0..1
  tvar99_headroom_usd: number;  // capital buffer headroom (optional use)
};

export type QuoteInput = {
  perilId: string;
  regime: Regime;
  notionalUSD: number;   // alias for limit
  attachmentPct: number; // 0..1 (if you encode as payout deductible)
  limitUSD: number;
  tenorDays: number;
  portfolio: PortfolioSide;
  curve: PerilSpec;
};

export type PriceBreakdown = {
  EL: number;           // Expected Loss
  RL: number;           // Risk Load
  CL: number;           // Capital Load
  LL: number;           // Liquidity Load
  O_H: number;          // Overhead
  premium: number;      // Total Premium = EL + RL + CL + LL + O_H
  utilization_after?: number;
  // Metadata for transparency
  metadata?: {
    regime: Regime;
    trigger_prob: number;
    expected_payout_given_trigger: number;
    hawkes_lambda_eff: number;
    utilization_before: number;
  };
};

export type PricingKnobs = {
  tvar_alpha: number;     // e.g., 0.99
  k_risk_load: number;    // e.g., 0.35 (35% of EL)
  overhead: number;       // e.g., 0.03 (3% of EL)
  liquidity_load: { base_bps: number; slope_bps_per_util: number };
  utilization_limits?: { target: number; hard: number };
  use_tvar_for_capital?: boolean; // whether to use TVaR for CL
};

/**
 * Core actuarial pricing function
 *
 * Computes premium as:
 * Premium = EL + RL + CL + LL + O/H
 *
 * Where:
 * - EL = L × p_trigger(T) × E[g(I) | I>u]
 * - RL = k_risk × EL (risk load)
 * - CL = TVaR-based capital charge (optional)
 * - LL = (base_bps + slope_bps × util) × L / 10,000 (liquidity load)
 * - O/H = overhead_pct × EL (overhead)
 */
export function pricePolicy(q: QuoteInput): PriceBreakdown {
  const { curve, regime, limitUSD: L, tenorDays, portfolio } = q;

  // Extract regime-specific parameters
  const u = curve.curve_params.pot_threshold_u[regime];
  const gpd = curve.curve_params.gpd[regime];
  const hawkes = curve.curve_params.clustering_hawkes[regime];

  // --- Frequency: Hawkes → effective exceedance rate above u (per day) ---
  const lambdaPerDay = hawkesEffectiveRate(hawkes);

  // --- Single-trigger probability over tenor ---
  const pTrig = triggerProb(lambdaPerDay, tenorDays);

  // --- Conditional mean payout given trigger ---
  const spec = { ...curve.payout };

  // Optional: apply attachment as intensity deductible
  // if (q.attachmentPct && q.attachmentPct > 0) {
  //   spec.deductible_intensity = q.attachmentPct * 0.1; // example mapping
  // }

  const Eg_given_trig = expectedPayoutConditional(u, gpd.xi, gpd.beta, spec);

  // --- Expected Loss (EL) ---
  const EL = L * pTrig * Eg_given_trig;

  // --- Pricing Knobs (with defaults) ---
  const knobs: PricingKnobs = {
    tvar_alpha: curve.pricing?.tvar_alpha ?? 0.99,
    k_risk_load: curve.pricing?.k_risk_load ?? 0.35,
    overhead: curve.pricing?.overhead ?? 0.03,
    liquidity_load: curve.pricing?.liquidity_load ?? {
      base_bps: 25,
      slope_bps_per_util: 120,
    },
    utilization_limits: curve.pricing?.utilization_limits ?? {
      target: 0.7,
      hard: 0.85,
    },
    use_tvar_for_capital: false, // default: simple risk load only
  };

  // --- Risk Load (RL) ---
  const RL = knobs.k_risk_load * EL;

  // --- Capital Load (CL) ---
  let CL = 0;
  if (knobs.use_tvar_for_capital) {
    // Advanced: use TVaR for tail risk capital
    const tvar = tvarPayoutConditional(u, gpd.xi, gpd.beta, spec, knobs.tvar_alpha);
    const capital_charge = 0.15; // 15% charge on TVaR excess over EL
    CL = L * pTrig * Math.max(0, tvar - Eg_given_trig) * capital_charge;
  }
  // Otherwise CL = 0 (risk already covered by RL)

  // --- Liquidity Load (LL) - utilization-aware ---
  const u_now = Math.min(1, Math.max(0, portfolio.utilization ?? 0));
  const LL_bps =
    knobs.liquidity_load.base_bps + knobs.liquidity_load.slope_bps_per_util * u_now;
  const LL = (LL_bps / 10_000) * L;

  // --- Overhead (O/H) ---
  const O_H = knobs.overhead * EL;

  // --- Total Premium ---
  const premium = EL + RL + CL + LL + O_H;

  // --- Utilization After (toy model: linear increase) ---
  const headroom = portfolio.tvar99_headroom_usd || 10 * L;
  const utilization_after = Math.min(1, u_now + premium / headroom);

  return {
    EL,
    RL,
    CL,
    LL,
    O_H,
    premium,
    utilization_after,
    metadata: {
      regime,
      trigger_prob: pTrig,
      expected_payout_given_trigger: Eg_given_trig,
      hawkes_lambda_eff: lambdaPerDay,
      utilization_before: u_now,
    },
  };
}

/**
 * Validate quote inputs
 */
export function validateQuoteInput(q: QuoteInput): string | null {
  if (q.limitUSD <= 0) return "Limit must be positive";
  if (q.tenorDays <= 0) return "Tenor must be positive";
  if (q.attachmentPct < 0 || q.attachmentPct > 1) return "Attachment must be in [0,1]";
  if (!q.curve.regimes.includes(q.regime)) return `Invalid regime: ${q.regime}`;
  if (q.portfolio.utilization < 0 || q.portfolio.utilization > 1) {
    return "Utilization must be in [0,1]";
  }

  // Check Hawkes stability
  const hawkes = q.curve.curve_params.clustering_hawkes[q.regime];
  const n = hawkes.alpha / hawkes.beta;
  if (n >= 1) return `Hawkes process unstable (branching ratio = ${n.toFixed(3)} >= 1)`;

  return null; // valid
}
