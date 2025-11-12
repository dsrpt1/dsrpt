// src/lib/risk/hazard.ts
// Actuarial hazard curve modeling for parametric risk instruments

export type Regime = "calm" | "volatile" | "crisis";

export type PayoutBand = {
  from: number;           // intensity lower bound (inclusive)
  to: number;             // intensity upper bound (inclusive)
  payout_at_from: number; // payout fraction at 'from'
  payout_at_to: number;   // payout fraction at 'to'
};

export type PayoutSpec = {
  type: "piecewise_linear";
  bands: PayoutBand[];
  cap: number;                 // max payout fraction
  deductible_intensity?: number; // horizontal deductible on intensity (optional)
};

export type HawkesParams = { mu: number; alpha: number; beta: number }; // beta = decay
export type GPDParams    = { xi: number; beta: number };                 // beta = scale

export type CurveParams = {
  pot_threshold_u: Record<Regime, number>;
  gpd: Record<Regime, GPDParams>;
  clustering_hawkes: Record<Regime, HawkesParams>;
};

export type PerilSpec = {
  id: string;
  display_name: string;
  regimes: Regime[];
  payout: PayoutSpec;
  curve_params: CurveParams;
  pricing?: {
    tvar_alpha: number;
    k_risk_load: number;
    overhead: number;
    liquidity_load: { base_bps: number; slope_bps_per_util: number };
    utilization_limits?: { target: number; hard: number };
  };
};

/**
 * Hawkes stationary effective rate
 * λ_eff = μ / (1 - n) where n = α/β is the branching ratio
 */
export function hawkesEffectiveRate({ mu, alpha, beta }: HawkesParams): number {
  // stationary effective exceedance rate above threshold u
  const n = alpha / beta;
  if (n >= 1) throw new Error("Hawkes branching ratio >= 1 (unstable)");
  return mu / (1 - n);
}

/**
 * Trigger probability over tenor T
 * p_trigger(T) = 1 - exp(-λ_eff * T)
 *
 * Convert tenorDays → time units used by λ. If your mu is "per day", use days.
 */
export function triggerProb(lambdaPerDay: number, tenorDays: number): number {
  const lambdaT = Math.max(0, lambdaPerDay) * Math.max(0, tenorDays);
  return 1 - Math.exp(-lambdaT);
}

// ---------- GPD (Generalized Pareto Distribution) ----------
// Support requires 1 + xi * y / beta > 0 (y >= 0)

/**
 * GPD Cumulative Distribution Function
 * F_Y(y) = 1 - (1 + ξy/β)^(-1/ξ)
 */
export function gpdCDF(y: number, xi: number, beta: number): number {
  if (y < 0) return 0;
  if (Math.abs(xi) < 1e-12) return 1 - Math.exp(-y / beta); // xi→0 ⇒ Exp(beta)
  const t = 1 + (xi * y) / beta;
  if (t <= 0) return 1; // beyond upper support for xi<0
  return 1 - Math.pow(t, -1 / xi);
}

/**
 * GPD Probability Density Function
 * f_Y(y) = (1/β) * (1 + ξy/β)^(-1/ξ - 1)
 */
export function gpdPDF(y: number, xi: number, beta: number): number {
  if (y < 0) return 0;
  if (Math.abs(xi) < 1e-12) return (1 / beta) * Math.exp(-y / beta);
  const t = 1 + (xi * y) / beta;
  if (t <= 0) return 0;
  return (1 / beta) * Math.pow(t, -1 / xi - 1);
}

/**
 * Piecewise-linear payout evaluator g(I)
 * Maps intensity I ∈ [0,1] to payout fraction ∈ [0, cap]
 */
export function payoutOfIntensity(I: number, spec: PayoutSpec): number {
  const cap = spec.cap ?? 1;
  let x = I;
  if (spec.deductible_intensity && spec.deductible_intensity > 0) {
    x = Math.max(0, I - spec.deductible_intensity);
  }
  if (spec.type !== "piecewise_linear") throw new Error("Only piecewise_linear supported");

  let y = 0;
  for (const b of spec.bands) {
    if (x < b.from || x > b.to) continue;
    const span = b.to - b.from;
    const w = span > 0 ? (x - b.from) / span : 0;
    y = b.payout_at_from + w * (b.payout_at_to - b.payout_at_from);
  }
  return Math.min(cap, Math.max(0, y));
}

/**
 * E[g(I) | I>u] where I = u + Y, Y ~ GPD(xi, beta)
 *
 * We integrate numerically over y ∈ [0, y_max], with a safe cutoff where GPD tail is ~0.
 * This is the conditional expected payout fraction given an exceedance event.
 */
export function expectedPayoutConditional(
  u: number,
  xi: number,
  beta: number,
  spec: PayoutSpec,
  yMax?: number
): number {
  // Choose a numeric cutoff for integration:
  // For xi>=0, tail is heavy — take a multiple of beta; for xi<0, upper bound finite: y < -beta/xi.
  let upper: number;
  if (xi < 0) {
    upper = Math.max(0, -beta / xi - 1e-9); // support limit
  } else {
    upper = yMax ?? 20 * beta; // heuristic; adjust if needed
  }

  // Simple trapezoidal integration
  const N = 2000;
  let sum = 0;
  for (let k = 0; k <= N; k++) {
    const y = (upper * k) / N;
    const I = u + y;
    const g = payoutOfIntensity(I, spec);
    const f = gpdPDF(y, xi, beta);
    const w = k === 0 || k === N ? 0.5 : 1; // trapezoid weights
    sum += w * g * f;
  }
  const Ey = (upper / N) * sum;
  return Ey; // already conditional on exceedance
}

/**
 * TVaR (Tail Value at Risk) for conditional payout
 * TVaR_α[g] = E[g(I) | g(I) > VaR_α]
 *
 * Useful for capital load calculations
 */
export function tvarPayoutConditional(
  u: number,
  xi: number,
  beta: number,
  spec: PayoutSpec,
  alpha: number = 0.99,
  yMax?: number
): number {
  // Choose a numeric cutoff for integration
  let upper: number;
  if (xi < 0) {
    upper = Math.max(0, -beta / xi - 1e-9);
  } else {
    upper = yMax ?? 20 * beta;
  }

  // First, find VaR_α (quantile)
  const N = 2000;
  let cumulativeProb = 0;
  let varQuantile = 0;

  for (let k = 0; k <= N; k++) {
    const y = (upper * k) / N;
    const f = gpdPDF(y, xi, beta);
    const dy = upper / N;
    cumulativeProb += f * dy;

    if (cumulativeProb >= alpha && varQuantile === 0) {
      varQuantile = y;
      break;
    }
  }

  // Now integrate conditional on y > varQuantile
  let sum = 0;
  let tailMass = 0;

  for (let k = 0; k <= N; k++) {
    const y = (upper * k) / N;
    if (y < varQuantile) continue;

    const I = u + y;
    const g = payoutOfIntensity(I, spec);
    const f = gpdPDF(y, xi, beta);
    const w = k === 0 || k === N ? 0.5 : 1;

    sum += w * g * f;
    tailMass += w * f;
  }

  const dy = upper / N;
  return tailMass > 0 ? (sum * dy) / (tailMass * dy) : 0;
}
