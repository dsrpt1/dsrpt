'use client';

import Link from 'next/link';

const sections = [
  {
    id: 'abstract',
    title: 'Abstract',
    content: `DSRPT is a parametric risk market for stablecoin depeg protection, deployed on Base. Unlike traditional insurance that requires claims adjudication, DSRPT settles payouts automatically when on-chain oracle conditions are met. The protocol combines an off-chain signal engine (trajectory-based regime classification) with on-chain actuarial pricing (hazard curve interpolation), connected by an OracleAdapter that eliminates the adverse selection gap between signal detection and premium repricing. The result is a self-adjusting market where premiums respond to real-time risk conditions and payouts are instant and deterministic.`,
  },
  {
    id: 'introduction',
    title: '1. Introduction',
    content: `Stablecoin depegs are the most underpriced risk in DeFi. UST's collapse erased $40B in value. USDC's Silicon Valley Bank shock triggered a 12% depeg in hours. FRAX experienced sustained contagion stress. In each case, DeFi participants had no way to hedge their exposure.

Traditional insurance markets cannot serve this need. They rely on slow claims processes, subjective loss assessment, and trusted intermediaries. DeFi needs parametric protection: coverage that triggers automatically when an oracle reports a depeg beyond a defined threshold, with payouts calculated deterministically from on-chain data.

DSRPT builds this market on three pillars:

A signal engine that classifies market regimes using trajectory-shaped features rather than endpoint rules, catching events like UST's one-way collapse that scalar classifiers miss.

A hazard curve engine that prices coverage using actuarial models calibrated to real depeg event data, with premiums that adjust dynamically based on regime, oracle state, and portfolio utilization.

An atomic bridge (OracleAdapter) that ensures zero latency between regime detection and premium repricing, closing the adverse selection window that would otherwise let sophisticated actors buy cheap coverage at stale prices.`,
  },
  {
    id: 'problem',
    title: '2. Problem Statement',
    content: `The core problem is twofold: stablecoin holders have unhedgeable exposure, and any attempt to create a hedging market creates an adverse selection attack surface.

Unhedgeable exposure: A DeFi protocol holding $50M in USDC has no way to buy protection against a depeg. Options markets are thin. Insurance protocols use discretionary claims processes. There is no instrument that pays out automatically when USDC drops below $0.98.

Adverse selection: If a market for depeg protection exists, informed actors will buy coverage moments before a depeg event, while the premium still reflects calm-market pricing. The gap between "the signal engine knows risk is elevated" and "the pricing engine reflects that risk" is the attack surface. Every block of latency between signal and repricing is a window for value extraction.

Classification failure: Existing risk models use scalar endpoint rules (e.g., "if severity > 30% and no recovery, classify as collapse"). These rules failed on UST because they checked terminal state, not trajectory. UST's collapse was a monotonic one-way path — the shape of the deterioration, not the endpoint, was the diagnostic signal.`,
  },
  {
    id: 'architecture',
    title: '3. Protocol Architecture',
    content: `DSRPT consists of six on-chain contracts and one off-chain signal engine, deployed on Base Mainnet.

On-chain contracts:

DsrptHazardEngine — The core pricing engine. Stores regime-specific hazard curves (Calm, Volatile, Crisis) with piecewise-linear interpolation across 7-day, 30-day, and 90-day calibration points. Premiums are calculated as: Premium = max(coverage * H(T) * marketMultiplier * bookMultiplier, minPremium), where H(T) is the cumulative hazard function for the active regime and tenor.

DsrptPolicyManager — Manages policy lifecycle: issuance, streaming premium accrual, claim submission, and settlement. Supports both fixed-term and streaming coverage models.

DsrptTreasuryManager — Tranche-based capital pool with three risk tiers: Junior (first-loss, 15% target yield), Mezzanine (second-loss, 8% target yield), and Senior (last-loss, 4% target yield). Seven-day withdrawal cooldown prevents bank runs.

OracleAggregator — Multi-source price aggregation with staleness checks, volatility calculation, and cross-venue disagreement detection. Feeds the market multiplier calculation.

OracleAdapter — The bridge between off-chain signal detection and on-chain pricing. Receives regime updates from the signal engine relayer and atomically calls proposeRegimeChange() and pushOracleState() on the HazardEngine in a single transaction. Zero block gap between signal and repricing.

KeepersAdapter — Chainlink Automation integration for periodic oracle snapshots and portfolio state updates.

Off-chain signal engine:

The Python-based terminal (deployed on Railway) polls stablecoin prices every 15 minutes, runs the classifier_v2 regime detection pipeline, and submits OracleAdapter.updateRegime() transactions on regime transitions. The same process that detects the signal also submits the on-chain update — no intermediate message queue or API, no additional latency.`,
  },
  {
    id: 'regime',
    title: '4. Regime Classification',
    content: `The classifier_v2 pipeline identifies five market regimes using trajectory-shaped features. This is the key upgrade over v1, which used endpoint-scalar rules and misclassified UST as "ambiguous."

Regime taxonomy:

AMBIGUOUS — Insufficient signal. Base pricing applies (1.00x premium loading). Maps to engine regime: Calm.

CONTAINED_STRESS — Mild persistent contagion. Severity between 1-12%, slow recovery, elevated persistence. Premium loading: 1.25x. Maps to engine regime: Volatile.

LIQUIDITY_DISLOCATION — High volume, low price impact. Execution risk without systemic failure. Premium loading: 1.10x. Maps to engine regime: Volatile.

COLLATERAL_SHOCK — Sharp asymmetric spike with fast recovery (e.g., USDC/SVB). High volume spike, bounded persistence, good recovery completeness. Premium loading: 1.50x, coverage cap enforced. Maps to engine regime: Crisis.

REFLEXIVE_COLLAPSE — Terminal one-way deterioration (e.g., UST). High monotonicity score, long deterioration run, low recovery completeness. All new issuance halted immediately. Maps to engine regime: Crisis.

Trajectory features (v2 additions):

monotonicity_score — Fraction of timesteps where severity is non-decreasing. High values indicate one-way deterioration.

deterioration_run — Longest consecutive run of increasing severity in hours. Long runs signal structural failure rather than transient shock.

early_late_ratio — Mean severity in first 25% vs last 25% of window. Values below 0.40 indicate conditions worsening over time.

recovery_completeness — How much of peak severity has resolved. Low values with high monotonicity confirm reflexive collapse.

abandonment_signal — Gap between raw and adjusted recovery completeness. Detects volume-collapse masking true terminal severity (the asset is abandoned, not recovered).`,
  },
  {
    id: 'pricing',
    title: '5. Actuarial Pricing Model',
    content: `Premium calculation follows a multi-factor actuarial model:

Step 1: Hazard curve interpolation. Each regime (Calm, Volatile, Crisis) has a calibrated hazard curve with three anchor points: H(7d), H(30d), H(90d). For tenors between anchors, piecewise-linear interpolation is used. Beyond 90 days, a tail slope extends the curve. Calm H(7d)=0.01%, H(30d)=0.05%, H(90d)=0.15%. Volatile H(7d)=0.05%, H(30d)=0.25%, H(90d)=0.80%. Crisis H(7d)=0.20%, H(30d)=1.00%, H(90d)=3.50%.

Step 2: Base expected loss. EL = coverage * H(T), where T is the policy tenor in days.

Step 3: Market multiplier. Derived from oracle state: peg deviation, realized volatility, cross-venue disagreement, and shock flag. Composite risk score scales the multiplier from 1.0x to maxMultiplierBps (3.0x). Stale oracle data (>1 hour) returns max multiplier as a conservative default.

Step 4: Book multiplier. Derived from portfolio and tranche utilization. Penalties for: utilization above 70%, capital ratio below 100%, concentration above 30%, and tranche stress (junior >90%, mezzanine >70%, senior >50%). Capped at 2.0x.

Step 5: Final premium. Premium = max(EL * marketMult * bookMult, coverage * minPremiumBps). The 0.25% minimum premium floor ensures treasury sustainability even in calm markets.

Payout calculation: Payout = policyLimit * f(d) * g(t), where f(d) is a convex severity factor (small deviations pay less) and g(t) is a linear duration factor (longer depeg events pay more, up to the threshold of 7 days).`,
  },
  {
    id: 'adverse-selection',
    title: '6. Adverse Selection Defense',
    content: `The OracleAdapter is the protocol's primary defense against adverse selection. The attack vector: a sophisticated actor observes an off-chain signal indicating elevated depeg risk and buys coverage before the on-chain pricing reflects that risk.

Defense mechanism: The signal engine and the chain relay run in the same process. When classifier_v2 detects a regime transition, the same tick that detects it also submits the on-chain updateRegime() transaction. Within that single transaction, the OracleAdapter:

1. Updates local regime state (confidence, escalation level, premium multiplier).
2. Calls proposeRegimeChange() on DsrptHazardEngine — regime upgrades (Calm to Volatile, Volatile to Crisis) execute immediately.
3. Calls pushOracleState() with the signal-derived peg deviation, volatility, and shock flag.
4. Applies issuance gates: ESCALATING and CRITICAL escalation levels block all new policy creation.
5. Starts 72-hour LP withdrawal lockup to prevent LPs from front-running a deepening crisis.

The result: there is no block in which the signal engine knows about elevated risk but the pricing engine does not. The adverse selection window is zero.

Regime downgrade timelocks provide additional safety. When conditions improve, the engine does not immediately reduce premiums. Crisis to Volatile has a 7-day timelock. Volatile to Calm has a 3-day timelock. Crisis to Calm requires 14 days. This asymmetry — instant escalation, slow de-escalation — is intentional. Risk increases take effect immediately; de-escalation is conservative.`,
  },
  {
    id: 'treasury',
    title: '7. Treasury & Capital Structure',
    content: `The DsrptTreasuryManager implements a tranche-based capital structure with three risk tiers:

Junior tranche — First-loss capital. Absorbs initial depeg payouts. Highest risk, highest yield target (15% APY). LPs who deposit here are betting that depeg events will be rare and small.

Mezzanine tranche — Second-loss capital. Only absorbs losses after junior is exhausted. Medium risk, 8% APY target.

Senior tranche — Last-loss capital. Only absorbs losses in catastrophic scenarios. Lowest risk, 4% APY target.

Withdrawal mechanics: All withdrawals require a 7-day cooldown period (requestWithdrawal followed by executeWithdrawal after cooldown). Additionally, the OracleAdapter enforces a 72-hour LP lockup after any regime transition. This prevents LPs from pulling capital after a signal fires but before claims materialize.

Capital health is monitored through three metrics: utilization (liabilities/assets), capital ratio (available capital / required TVaR), and peril concentration (single peril exposure / total book). These feed the book multiplier in the pricing model — as the pool becomes more stressed, premiums automatically increase to attract new capital.`,
  },
  {
    id: 'deployment',
    title: '8. Deployment',
    content: `DSRPT is deployed on Base Mainnet with the following contract addresses:

OracleAggregator: 0xB203E42D84B70a60E3032F5Ed661C50cc7E9e3Cb
DsrptTreasuryManager: 0x540C8c83F8173AD3835eefeaAdb91fe86E7189e2
DsrptHazardEngine: 0x43634429c8Ff62D9808558cb150a76D32140Ba0e
DsrptPolicyManager: 0xc1D0eeA34dAE0A76A7972412f802C4EA720C9B36
KeepersAdapter: 0x8A7149E93a5309f2B5Ca5BcdA8a1D5645026F1C8
OracleAdapter: 0x0f43Ca50CFdFb916b2782b9cF878e3F422559524

Signal engine: Deployed on Railway, polling every 15 minutes.
Price oracle: Chainlink USDC/USD on Base.
Initial peril: USDC depeg (perilId: keccak256("USDC_depeg")).
Reserve asset: USDC.

The protocol currently monitors USDC, USDT, DAI, and FRAX for regime classification. On-chain pricing and policy issuance is active for USDC depeg coverage.`,
  },
  {
    id: 'roadmap',
    title: '9. Roadmap',
    content: `Phase 1 (Complete): Research and backtesting. Regime classifier v1 and v2 developed and validated against UST, USDC/SVB, and FRAX historical data. Hazard curve calibration from actuarial analysis of depeg events.

Phase 2 (Complete): Production deployment. Full protocol deployed on Base Mainnet. Signal engine running on Railway with chain relay. OracleAdapter bridging signal detection to on-chain pricing with zero-latency atomic updates.

Phase 3 (Next): Multi-asset coverage. Extend peril registry to USDT, DAI, and other stablecoins. Asset-specific hazard curve calibration. Cross-asset correlation modeling for portfolio risk.

Phase 4: Institutional integration. API for programmatic policy issuance. Streaming coverage for protocol treasuries. Webhook notifications for regime transitions. Custom peril definitions for institutional hedging needs.`,
  },
  {
    id: 'references',
    title: 'References',
    content: `[1] UST/LUNA Collapse Analysis — depeg trajectory data, May 2022. Source: on-chain price feeds, Binance/Kraken.

[2] USDC/SVB Shock Analysis — collateral impairment event, March 2023. Source: on-chain price feeds, Chainlink.

[3] FRAX Stress Period Analysis — contagion stress event, March 2023. Source: on-chain price feeds, CoinGecko.

[4] Hazard Rate Models for Credit Risk — actuarial foundations for the cumulative hazard function H(T) = baseProbPerDay * T + slopePerDay * T^2 / 2.

[5] Parametric Insurance Design — trigger-based settlement mechanisms for deterministic payouts without claims adjudication.`,
  },
];

export default function WhitepaperPage() {
  return (
    <main className="page-container whitepaper-page">
      {/* Header */}
      <header className="page-header">
        <Link href="/" className="back-link">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </Link>
        <div className="page-title-section">
          <h1>Whitepaper</h1>
          <p>DSRPT Protocol: Parametric Risk Markets for Stablecoin Depeg Protection</p>
          <span className="version-badge">Version 2.0 | March 2026</span>
        </div>
      </header>

      {/* Table of Contents */}
      <aside className="toc-sidebar">
        <h3>Contents</h3>
        <nav className="toc-nav">
          {sections.map((section) => (
            <a key={section.id} href={`#${section.id}`} className="toc-link">
              {section.title}
            </a>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <article className="whitepaper-content">
        {sections.map((section) => (
          <section key={section.id} id={section.id} className="wp-section">
            <h2>{section.title}</h2>
            {section.content.split('\n\n').map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </section>
        ))}
      </article>
    </main>
  );
}
