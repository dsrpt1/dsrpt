"""
Dsrpt Phase 1 — Regime Classifier

Extracts structural features from early event data and assigns
provisional regime labels. This is not a trained ML classifier —
it is a rule-based feature extractor with explicit, auditable logic.

Why rule-based first:
  - Three events is not enough to train a classifier
  - Rules are inspectable and falsifiable
  - Rules become training labels when you have 20+ events

Regime taxonomy:
  1. reflexive_collapse     — self-reinforcing spiral, no price floor
  2. collateral_shock       — sharp impairment, recovery possible
  3. liquidity_dislocation  — venue-specific, not systemic
  4. contained_stress       — contagion without structural failure
  5. ambiguous              — insufficient signal to classify

Features extracted (all computable from price + volume series):
  - initial_drop_1h:        severity at 1-hour mark
  - initial_drop_6h:        severity at 6-hour mark
  - max_severity:           peak adjusted severity
  - recovery_half_life_h:   hours to recover 50% of peak severity
  - severity_persistence:   fraction of window above 1% threshold
  - depth_loss_rate:        rate of severity increase (early slope)
  - volume_spike_ratio:     peak volume / baseline volume
  - terminal_severity:      severity in final 10% of window
"""

import numpy as np
import pandas as pd
from dataclasses import dataclass, field
from typing import Optional


# ─────────────────────────────────────────────
# Regime Taxonomy
# ─────────────────────────────────────────────

REGIME_LABELS = [
    "reflexive_collapse",
    "collateral_shock",
    "liquidity_dislocation",
    "contained_stress",
    "ambiguous",
]

REGIME_DESCRIPTIONS = {
    "reflexive_collapse":    "Self-reinforcing spiral — no collateral floor, terminal price path",
    "collateral_shock":      "Sharp reserve impairment — fast depeg, recovery possible with intervention",
    "liquidity_dislocation": "Venue-specific fragmentation — systemic risk low, execution risk high",
    "contained_stress":      "Contagion spread without structural failure — bounded depeg, slow recovery",
    "ambiguous":             "Insufficient signal to classify — watch for regime transition",
}


# ─────────────────────────────────────────────
# Feature Extraction
# ─────────────────────────────────────────────

@dataclass
class RegimeFeatures:
    event_key:              str
    initial_drop_1h:        float   # severity at hour 1
    initial_drop_6h:        float   # severity at hour 6
    max_severity:           float   # peak adjusted severity
    recovery_half_life_h:   float   # hours to recover 50% of peak (inf if no recovery)
    severity_persistence:   float   # fraction of window above 1% threshold
    depth_loss_rate:        float   # severity slope in first 20% of window
    volume_spike_ratio:     float   # peak vol / median vol
    terminal_severity:      float   # mean severity in final 10% of window
    total_hours:            float   # event window length


def extract_features(df: pd.DataFrame, event_key: str) -> RegimeFeatures:
    """
    Extract regime-diagnostic features from enriched timestep DataFrame.
    Expects columns: timestamp, adjusted_severity, volume
    """
    df = df.sort_values("timestamp").reset_index(drop=True)
    n  = len(df)

    # Time axis in hours from event start
    t0 = df["timestamp"].iloc[0]
    df["hours"] = (df["timestamp"] - t0).dt.total_seconds() / 3600
    total_hours = df["hours"].iloc[-1]

    sev = df["adjusted_severity"].values
    vol = df["volume"].values
    hrs = df["hours"].values

    # 1h / 6h initial drop (nearest row)
    def sev_at_hour(h):
        idx = np.argmin(np.abs(hrs - h))
        return sev[idx]

    initial_drop_1h = sev_at_hour(1.0)
    initial_drop_6h = sev_at_hour(6.0)

    # Peak severity
    max_severity = sev.max()
    peak_idx     = sev.argmax()

    # Recovery half-life: hours from peak to 50% of peak severity
    half_peak = max_severity * 0.5
    post_peak = sev[peak_idx:]
    post_hrs  = hrs[peak_idx:]
    recovery_indices = np.where(post_peak <= half_peak)[0]
    if len(recovery_indices) > 0:
        recovery_half_life_h = post_hrs[recovery_indices[0]] - hrs[peak_idx]
    else:
        recovery_half_life_h = float("inf")   # no recovery observed

    # Severity persistence: fraction above 1% threshold
    severity_persistence = (sev >= 0.01).mean()

    # Depth loss rate: slope of severity in first 20% of window
    cutoff = int(n * 0.20) + 1
    if cutoff >= 2:
        early_sev = sev[:cutoff]
        early_hrs = hrs[:cutoff]
        if early_hrs[-1] > early_hrs[0]:
            depth_loss_rate = (early_sev[-1] - early_sev[0]) / (early_hrs[-1] - early_hrs[0])
        else:
            depth_loss_rate = 0.0
    else:
        depth_loss_rate = 0.0

    # Volume spike ratio
    median_vol = np.median(vol)
    volume_spike_ratio = vol.max() / median_vol if median_vol > 0 else 1.0

    # Terminal severity: mean in final 10% of window
    tail_start = int(n * 0.90)
    terminal_severity = sev[tail_start:].mean()

    return RegimeFeatures(
        event_key            = event_key,
        initial_drop_1h      = initial_drop_1h,
        initial_drop_6h      = initial_drop_6h,
        max_severity         = max_severity,
        recovery_half_life_h = recovery_half_life_h,
        severity_persistence = severity_persistence,
        depth_loss_rate      = depth_loss_rate,
        volume_spike_ratio   = volume_spike_ratio,
        terminal_severity    = terminal_severity,
        total_hours          = total_hours,
    )


# ─────────────────────────────────────────────
# Rule-Based Classifier
# ─────────────────────────────────────────────

@dataclass
class RegimeResult:
    event_key:    str
    regime:       str
    confidence:   str          # "high" / "medium" / "low"
    features:     RegimeFeatures
    rules_fired:  list = field(default_factory=list)
    notes:        str  = ""


def classify_regime(features: RegimeFeatures) -> RegimeResult:
    """
    Rule-based regime classification.
    Rules are ordered by specificity — first match wins.
    Confidence degrades when multiple rules partially fire.
    """
    f = features
    rules_fired = []

    # ── Rule 1: Reflexive Collapse ──────────────────────────────────
    # Signature: rapid descent, no recovery, terminal severity stays elevated
    if (
        f.max_severity > 0.30 and
        f.terminal_severity > 0.10 and
        f.recovery_half_life_h == float("inf") and
        f.depth_loss_rate > 0.01
    ):
        rules_fired.append("R1: max_severity>30% + no_recovery + terminal_elevated + fast_descent")
        return RegimeResult(
            event_key   = f.event_key,
            regime      = "reflexive_collapse",
            confidence  = "high",
            features    = f,
            rules_fired = rules_fired,
            notes       = "Terminal severity elevated — no price floor detected. Classic death spiral signature.",
        )

    # ── Rule 2: Collateral Shock ─────────────────────────────────────
    # Signature: sharp initial drop, fast partial/full recovery, low terminal severity
    if (
        f.max_severity > 0.04 and
        f.recovery_half_life_h < 24 and
        f.terminal_severity < 0.02 and
        f.volume_spike_ratio > 3.0
    ):
        rules_fired.append("R2: sharp_drop + fast_recovery + low_terminal + volume_spike")
        return RegimeResult(
            event_key   = f.event_key,
            regime      = "collateral_shock",
            confidence  = "high",
            features    = f,
            rules_fired = rules_fired,
            notes       = "Sharp V-shape with high volume spike. Reserve impairment shock with market-driven recovery.",
        )

    # ── Rule 3: Contained Stress ──────────────────────────────────────
    # Signature: mild-moderate severity, persistent but bounded, slow recovery
    if (
        f.max_severity > 0.01 and
        f.max_severity <= 0.10 and
        f.severity_persistence > 0.20 and
        f.recovery_half_life_h > 12
    ):
        rules_fired.append("R3: mild_severity + persistent + slow_recovery")
        return RegimeResult(
            event_key   = f.event_key,
            regime      = "contained_stress",
            confidence  = "medium",
            features    = f,
            rules_fired = rules_fired,
            notes       = "Sustained mild stress without structural failure. Contagion spread, contained.",
        )

    # ── Rule 4: Liquidity Dislocation ────────────────────────────────
    # Signature: brief, low severity, high volume spike (execution risk not price risk)
    if (
        f.max_severity < 0.03 and
        f.severity_persistence < 0.15 and
        f.volume_spike_ratio > 4.0
    ):
        rules_fired.append("R4: low_severity + brief + high_volume")
        return RegimeResult(
            event_key   = f.event_key,
            regime      = "liquidity_dislocation",
            confidence  = "medium",
            features    = f,
            rules_fired = rules_fired,
            notes       = "High volume with low price impact — likely venue-specific liquidity fragmentation.",
        )

    # ── Default: Ambiguous ────────────────────────────────────────────
    return RegimeResult(
        event_key   = f.event_key,
        regime      = "ambiguous",
        confidence  = "low",
        features    = f,
        rules_fired = ["no_primary_rule_fired"],
        notes       = "Mixed signals. Needs additional data (collateral type, venue dispersion, governance context).",
    )


def classify_event(df: pd.DataFrame, event_key: str) -> RegimeResult:
    """Full pipeline: enriched DataFrame → regime label."""
    features = extract_features(df, event_key)
    return classify_regime(features)


def features_to_df(results: list) -> pd.DataFrame:
    """Convert list of RegimeResults to a flat DataFrame for analysis."""
    rows = []
    for r in results:
        f = r.features
        rows.append({
            "event_key":            f.event_key,
            "regime":               r.regime,
            "confidence":           r.confidence,
            "max_severity":         round(f.max_severity, 4),
            "initial_drop_1h":      round(f.initial_drop_1h, 4),
            "initial_drop_6h":      round(f.initial_drop_6h, 4),
            "recovery_half_life_h": round(f.recovery_half_life_h, 2) if f.recovery_half_life_h != float("inf") else 9999,
            "severity_persistence": round(f.severity_persistence, 4),
            "depth_loss_rate":      round(f.depth_loss_rate, 5),
            "volume_spike_ratio":   round(f.volume_spike_ratio, 2),
            "terminal_severity":    round(f.terminal_severity, 4),
            "rules_fired":          " | ".join(r.rules_fired),
            "notes":                r.notes,
        })
    return pd.DataFrame(rows)
