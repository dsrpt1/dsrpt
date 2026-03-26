"""
Dsrpt Phase 1 — Regime Classifier v2

Key upgrade: trajectory-shaped features replace scalar endpoint rules.

v1 problem: UST fired "ambiguous" because rules checked endpoint state.
v2 fix: UST should classify on trajectory shape — it entered a one-way regime.

New features added:
  - monotonicity_score:       fraction of timesteps where severity is non-decreasing
  - time_to_peak_h:           hours from event start to max severity
  - peak_recovery_asymmetry:  ratio of rise time to recovery time (∞ = no recovery)
  - severity_auc:             area under adjusted severity curve (path integral)
  - early_late_ratio:         mean severity in first 25% vs last 25% of window

Rule additions:
  R1b: reflexive_collapse via trajectory (monotonic deterioration, one-way regime)
       — catches UST even when terminal severity has noise
  R2b: collateral_shock via shape asymmetry (fast spike, fast recovery, low persistence)
       — separates USDC from contained stress events

Design principle:
  Rules fire on trajectory geometry, not just endpoint scalars.
  Confidence degrades when trajectory and endpoint signals conflict.
"""

import numpy as np
import pandas as pd
from dataclasses import dataclass, field
from typing import Optional


# ─────────────────────────────────────────────
# Regime Taxonomy (unchanged)
# ─────────────────────────────────────────────

REGIME_LABELS = [
    "reflexive_collapse",
    "collateral_shock",
    "liquidity_dislocation",
    "contained_stress",
    "ambiguous",
]

REGIME_DESCRIPTIONS = {
    "reflexive_collapse":    "One-way deterioration — monotonic severity path, no structural floor",
    "collateral_shock":      "Sharp asymmetric spike — fast onset, fast recovery, low persistence",
    "liquidity_dislocation": "High volume / low price impact — execution risk, not systemic",
    "contained_stress":      "Sustained mild elevation — contagion without structural failure",
    "ambiguous":             "Mixed trajectory signals — needs additional context",
}


# ─────────────────────────────────────────────
# v2 Feature Set
# ─────────────────────────────────────────────

@dataclass
class RegimeFeatures:
    event_key: str

    # v1 scalar features (retained)
    initial_drop_1h:        float
    initial_drop_6h:        float
    max_severity:           float
    recovery_half_life_h:   float
    severity_persistence:   float
    depth_loss_rate:        float
    volume_spike_ratio:     float
    terminal_severity:      float
    total_hours:            float

    # v2 trajectory features (new)
    monotonicity_score:      float   # fraction of steps where Δsev ≥ 0
    time_to_peak_h:          float   # hours from start to peak severity
    peak_recovery_asymmetry: float   # rise_time / recovery_time (large = one-way)
    severity_auc:            float   # ∫ adjusted_severity dt (normalized by window)
    early_late_ratio:        float   # mean(first 25%) / mean(last 25%) severity
    deterioration_run:       float   # longest consecutive run of increasing severity (hours)
    recovery_completeness:   float   # (peak_sev - terminal_sev) / peak_sev
    abandonment_signal:      float   # raw_recovery_completeness - adj_recovery_completeness (>0 = volume abandoned)


def extract_features(df: pd.DataFrame, event_key: str) -> RegimeFeatures:
    """
    Extract full v2 feature set from enriched timestep DataFrame.
    Expects: timestamp, adjusted_severity, volume
    """
    df = df.sort_values("timestamp").reset_index(drop=True)
    n  = len(df)

    t0 = df["timestamp"].iloc[0]
    df["hours"] = (df["timestamp"] - t0).dt.total_seconds() / 3600
    total_hours = df["hours"].iloc[-1]

    sev = df["adjusted_severity"].values
    vol = df["volume"].values
    hrs = df["hours"].values

    # ── v1 scalar features ─────────────────────────────────────────

    def sev_at_hour(h):
        idx = np.argmin(np.abs(hrs - h))
        return sev[idx]

    initial_drop_1h = sev_at_hour(1.0)
    initial_drop_6h = sev_at_hour(6.0)
    max_severity    = sev.max()
    peak_idx        = sev.argmax()

    half_peak = max_severity * 0.5
    post_peak = sev[peak_idx:]
    post_hrs  = hrs[peak_idx:]
    recovery_indices = np.where(post_peak <= half_peak)[0]
    recovery_half_life_h = (
        post_hrs[recovery_indices[0]] - hrs[peak_idx]
        if len(recovery_indices) > 0 else float("inf")
    )

    severity_persistence = (sev >= 0.01).mean()

    cutoff = max(int(n * 0.20), 2)
    early_sev = sev[:cutoff]; early_hrs = hrs[:cutoff]
    depth_loss_rate = (
        (early_sev[-1] - early_sev[0]) / (early_hrs[-1] - early_hrs[0])
        if early_hrs[-1] > early_hrs[0] else 0.0
    )

    median_vol       = np.median(vol)
    volume_spike_ratio = vol.max() / median_vol if median_vol > 0 else 1.0
    terminal_severity  = sev[int(n * 0.90):].mean()

    # ── v2 trajectory features ─────────────────────────────────────

    # Monotonicity: fraction of consecutive pairs where severity increases
    deltas = np.diff(sev)
    monotonicity_score = float((deltas >= 0).mean()) if len(deltas) > 0 else 0.0

    # Time to peak
    time_to_peak_h = float(hrs[peak_idx])

    # Peak-recovery asymmetry: rise_time / recovery_time
    rise_time = time_to_peak_h  # from start
    recovery_time = recovery_half_life_h  # from peak to half-peak
    if recovery_time == float("inf") or recovery_time == 0:
        peak_recovery_asymmetry = float("inf")
    else:
        peak_recovery_asymmetry = rise_time / recovery_time

    # Severity AUC (trapezoid, normalized by window length)
    trapz = getattr(np, "trapezoid", getattr(np, "trapz", None))
    severity_auc = float(trapz(sev, hrs) / total_hours) if total_hours > 0 else 0.0

    # Early/late ratio
    q25 = int(n * 0.25)
    q75 = int(n * 0.75)
    early_mean = sev[:q25].mean() if q25 > 0 else 0.0
    late_mean  = sev[q75:].mean() if q75 < n else sev[-1]
    early_late_ratio = (
        early_mean / late_mean if late_mean > 1e-6
        else (10.0 if early_mean > 0 else 1.0)
    )

    # Longest consecutive run of increasing severity (in hours)
    run_lengths = []
    current_run_start_idx = 0
    in_run = False
    for i, d in enumerate(deltas):
        if d >= 0:
            if not in_run:
                current_run_start_idx = i
                in_run = True
        else:
            if in_run:
                run_lengths.append(hrs[i] - hrs[current_run_start_idx])
            in_run = False
    if in_run:
        run_lengths.append(hrs[-1] - hrs[current_run_start_idx])
    deterioration_run = max(run_lengths) if run_lengths else 0.0

    # Recovery completeness: how much of peak severity resolved
    recovery_completeness = (
        (max_severity - terminal_severity) / max_severity
        if max_severity > 0 else 1.0
    )

    # Raw (unadjusted) terminal severity — for volume-collapse delta diagnostic
    # If raw_terminal_severity is high but adjusted is low → abandonment, not recovery
    raw_terminal_severity = df["severity"].iloc[int(n * 0.90):].mean() if "severity" in df.columns else terminal_severity
    raw_recovery_completeness = (
        (df["severity"].max() - raw_terminal_severity) / df["severity"].max()
        if "severity" in df.columns and df["severity"].max() > 0 else recovery_completeness
    )
    # Abandonment signal: large gap between raw and adjusted terminal severity
    # adj_rc > raw_rc means: adjusted measure claims recovery that price data doesn't show
    # This is the volume-collapse abandonment signature
    abandonment_signal = max(0.0, raw_recovery_completeness - recovery_completeness)
    # Note: recovery_completeness is adj-based, raw_recovery_completeness is price-based
    # Correct direction: abandonment = adj_rc HIGHER than raw_rc
    abandonment_signal = max(0.0, recovery_completeness - raw_recovery_completeness)

    return RegimeFeatures(
        event_key               = event_key,
        initial_drop_1h         = initial_drop_1h,
        initial_drop_6h         = initial_drop_6h,
        max_severity            = max_severity,
        recovery_half_life_h    = recovery_half_life_h,
        severity_persistence    = severity_persistence,
        depth_loss_rate         = depth_loss_rate,
        volume_spike_ratio      = volume_spike_ratio,
        terminal_severity       = terminal_severity,
        total_hours             = total_hours,
        monotonicity_score      = monotonicity_score,
        time_to_peak_h          = time_to_peak_h,
        peak_recovery_asymmetry = peak_recovery_asymmetry,
        severity_auc            = severity_auc,
        early_late_ratio        = early_late_ratio,
        deterioration_run       = deterioration_run,
        recovery_completeness   = recovery_completeness,
        abandonment_signal      = abandonment_signal,
    )


# ─────────────────────────────────────────────
# v2 Rule-Based Classifier
# ─────────────────────────────────────────────

@dataclass
class RegimeResult:
    event_key:   str
    regime:      str
    confidence:  str
    features:    RegimeFeatures
    rules_fired: list = field(default_factory=list)
    notes:       str  = ""
    version:     str  = "v2"


def classify_regime(features: RegimeFeatures) -> RegimeResult:
    """
    v2 classifier — trajectory-first rule ordering.

    Rule hierarchy:
      R1a: reflexive_collapse (endpoint — retained for strong cases)
      R1b: reflexive_collapse (trajectory — new, catches UST)
      R2a: collateral_shock   (endpoint)
      R2b: collateral_shock   (shape asymmetry — new)
      R3:  contained_stress   (unchanged)
      R4:  liquidity_disloc.  (unchanged)
      R5:  ambiguous
    """
    f = features
    rules = []

    # ── R1a: Reflexive Collapse (endpoint, high confidence) ─────────
    if (
        f.max_severity > 0.30 and
        f.terminal_severity > 0.10 and
        f.recovery_half_life_h == float("inf") and
        f.depth_loss_rate > 0.01
    ):
        rules.append("R1a: endpoint — max_sev>30% + no_recovery + terminal_elevated")
        return RegimeResult(
            event_key  = f.event_key,
            regime     = "reflexive_collapse",
            confidence = "high",
            features   = f,
            rules_fired= rules,
            notes      = "Terminal severity elevated. No price floor. Endpoint confirmed death spiral.",
        )

    # ── R1b: Reflexive Collapse (trajectory — catches UST) ──────────
    # Fires on: high monotonicity + sustained deterioration run +
    # low early/late ratio (got worse over time) + low recovery completeness
    if (
        f.monotonicity_score > 0.55 and
        f.deterioration_run  > (f.total_hours * 0.25) and
        f.early_late_ratio   < 0.40 and
        f.recovery_completeness < 0.50 and
        f.max_severity > 0.10
    ):
        rules.append("R1b: trajectory — monotonic>55% + long_run + late>early + incomplete_recovery")
        confidence = "high" if f.monotonicity_score > 0.65 else "medium"
        return RegimeResult(
            event_key  = f.event_key,
            regime     = "reflexive_collapse",
            confidence = confidence,
            features   = f,
            rules_fired= rules,
            notes      = (
                f"One-way regime detected. Monotonicity={f.monotonicity_score:.2f}, "
                f"deterioration run={f.deterioration_run:.1f}h, "
                f"recovery completeness={f.recovery_completeness:.2f}. "
                "Trajectory consistent with reflexive collapse."
            ),
        )

    # ── R1c: Abandonment Collapse (volume-collapse delta) ───────────
    # Fires when liquidity abandonment is masking true terminal severity.
    # The signal: raw price severity stays high at end, but adjusted
    # severity is suppressed because volume has evaporated.
    # Distinguishes: "price recovered" from "no one is trading a dead asset"
    if (
        f.abandonment_signal > 0.30 and   # large gap between raw and adjusted recovery
        f.early_late_ratio   < 0.50 and   # severity increased over window
        f.max_severity       > 0.15 and   # meaningful depeg occurred
        f.severity_persistence > 0.40     # sustained, not brief
    ):
        rules.append("R1c: abandonment — volume_collapse_masks_terminal_severity")
        return RegimeResult(
            event_key  = f.event_key,
            regime     = "reflexive_collapse",
            confidence = "medium",
            features   = f,
            rules_fired= rules,
            notes      = (
                f"Volume abandonment detected. Abandonment signal={f.abandonment_signal:.2f}. "
                f"Raw price severity remains high but adjusted severity suppressed by volume collapse. "
                "Asset is abandoned, not recovered — classify as structural collapse."
            ),
        )

    # ── R2a: Collateral Shock (endpoint, high confidence) ───────────
    if (
        f.max_severity > 0.04 and
        f.recovery_half_life_h < 24 and
        f.terminal_severity < 0.02 and
        f.volume_spike_ratio > 3.0
    ):
        rules.append("R2a: endpoint — sharp_drop + fast_recovery + low_terminal + vol_spike")
        return RegimeResult(
            event_key  = f.event_key,
            regime     = "collateral_shock",
            confidence = "high",
            features   = f,
            rules_fired= rules,
            notes      = "Sharp V-shape. High volume spike. Reserve impairment with market-driven recovery.",
        )

    # ── R2b: Collateral Shock (shape asymmetry) ─────────────────────
    # Fires on: fast rise, fast fall, high early/late ratio, good recovery
    if (
        f.max_severity > 0.02 and
        f.recovery_completeness > 0.70 and
        f.early_late_ratio > 2.0 and
        f.peak_recovery_asymmetry != float("inf") and
        f.severity_persistence < 0.35
    ):
        rules.append("R2b: shape — fast_rise + high_recovery + early>late + bounded_persistence")
        confidence = "high" if f.recovery_completeness > 0.85 else "medium"
        return RegimeResult(
            event_key  = f.event_key,
            regime     = "collateral_shock",
            confidence = confidence,
            features   = f,
            rules_fired= rules,
            notes      = (
                f"Asymmetric spike. Recovery completeness={f.recovery_completeness:.2f}, "
                f"early/late ratio={f.early_late_ratio:.2f}. "
                "Shape consistent with external impairment shock, not structural failure."
            ),
        )

    # ── R3: Contained Stress ────────────────────────────────────────
    if (
        f.max_severity > 0.01 and
        f.max_severity <= 0.12 and
        f.severity_persistence > 0.20 and
        f.recovery_half_life_h > 12
    ):
        rules.append("R3: mild_severity + persistent + slow_recovery")
        return RegimeResult(
            event_key  = f.event_key,
            regime     = "contained_stress",
            confidence = "medium",
            features   = f,
            rules_fired= rules,
            notes      = "Sustained mild stress. Contagion without structural failure.",
        )

    # ── R4: Liquidity Dislocation ───────────────────────────────────
    if (
        f.max_severity < 0.03 and
        f.severity_persistence < 0.15 and
        f.volume_spike_ratio > 4.0
    ):
        rules.append("R4: low_severity + brief + high_volume")
        return RegimeResult(
            event_key  = f.event_key,
            regime     = "liquidity_dislocation",
            confidence = "medium",
            features   = f,
            rules_fired= rules,
            notes      = "High volume / low price impact. Venue-specific fragmentation.",
        )

    # ── R5: Ambiguous ───────────────────────────────────────────────
    # Surface the best partial match as a diagnostic hint
    partial = _best_partial_match(f)
    return RegimeResult(
        event_key  = f.event_key,
        regime     = "ambiguous",
        confidence = "low",
        features   = f,
        rules_fired= ["R5: no_primary_rule_fired" + (f" (closest: {partial})" if partial else "")],
        notes      = f"Mixed signals. Closest regime: {partial or 'none'}. Add venue/collateral context.",
    )


def _best_partial_match(f: RegimeFeatures) -> str:
    """Heuristic: which regime's features are partially satisfied?"""
    scores = {
        "reflexive_collapse": (
            (f.monotonicity_score > 0.50) +
            (f.early_late_ratio < 0.60) +
            (f.recovery_completeness < 0.60)
        ),
        "collateral_shock": (
            (f.recovery_completeness > 0.60) +
            (f.early_late_ratio > 1.5) +
            (f.severity_persistence < 0.40)
        ),
        "contained_stress": (
            (0.01 < f.max_severity < 0.15) +
            (f.severity_persistence > 0.20)
        ),
    }
    best = max(scores, key=scores.get)
    return best if scores[best] >= 2 else ""


def classify_event(df: pd.DataFrame, event_key: str) -> RegimeResult:
    features = extract_features(df, event_key)
    return classify_regime(features)


def features_to_df(results: list) -> pd.DataFrame:
    rows = []
    for r in results:
        f = r.features
        rows.append({
            "event_key":              f.event_key,
            "regime":                 r.regime,
            "confidence":             r.confidence,
            "version":                r.version,
            # v1 features
            "max_severity":           round(f.max_severity, 4),
            "initial_drop_1h":        round(f.initial_drop_1h, 4),
            "initial_drop_6h":        round(f.initial_drop_6h, 4),
            "recovery_half_life_h":   round(f.recovery_half_life_h, 2) if f.recovery_half_life_h != float("inf") else 9999,
            "severity_persistence":   round(f.severity_persistence, 4),
            "terminal_severity":      round(f.terminal_severity, 4),
            "volume_spike_ratio":     round(f.volume_spike_ratio, 2),
            # v2 trajectory features
            "monotonicity_score":     round(f.monotonicity_score, 4),
            "time_to_peak_h":         round(f.time_to_peak_h, 2),
            "peak_recovery_asymmetry":round(f.peak_recovery_asymmetry, 3) if f.peak_recovery_asymmetry != float("inf") else 9999,
            "severity_auc":           round(f.severity_auc, 4),
            "early_late_ratio":       round(f.early_late_ratio, 3),
            "deterioration_run":      round(f.deterioration_run, 2),
            "recovery_completeness":  round(f.recovery_completeness, 4),
            "rules_fired":            " | ".join(r.rules_fired),
            "notes":                  r.notes,
        })
    return pd.DataFrame(rows)
