"""
Dsrpt Terminal — Feature Engine

Wraps classifier_v2 feature extraction for live/replay use.
Adds confidence scoring based on feature signal strength.

Early Warning Mode:
  Before a regime fully fires, the engine emits a pre-signal
  with a rising confidence score. This is how traders actually
  use signals — they don't wait for certainty, they act on
  rising probability.

Confidence scoring:
  Each rule has partial-match scoring. As features approach
  thresholds, confidence rises continuously rather than
  snapping from 0 to 1.
"""

import sys
import os
import numpy as np
import pandas as pd
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from src.pipeline.rl_surface import (
    compute_depeg_severity, compute_liquidity_weight, compute_adjusted_severity
)
from src.regime.classifier_v2 import extract_features, classify_regime, RegimeFeatures


def enrich_window(df: pd.DataFrame) -> pd.DataFrame:
    """Apply severity pipeline to raw window DataFrame."""
    df = compute_depeg_severity(df)
    df = compute_liquidity_weight(df)
    df = compute_adjusted_severity(df)
    return df


def compute_partial_confidence(features: RegimeFeatures) -> dict:
    """
    Compute partial match scores for each regime.
    Returns dict of regime -> confidence in [0, 1].

    This is the Early Warning Mode signal:
    confidence rises as features approach rule thresholds,
    before the rule fully fires.
    """
    f = features

    def sigmoid(x, center, scale=10):
        return 1.0 / (1.0 + np.exp(-scale * (x - center)))

    def inv_sigmoid(x, center, scale=10):
        return 1.0 / (1.0 + np.exp(scale * (x - center)))

    # ── Reflexive Collapse ──────────────────────────────────────────
    rc_score = np.mean([
        sigmoid(f.monotonicity_score,      0.55),
        sigmoid(f.deterioration_run / max(f.total_hours, 1), 0.25),
        inv_sigmoid(f.early_late_ratio,    0.40),
        inv_sigmoid(f.recovery_completeness, 0.50),
        sigmoid(f.abandonment_signal,      0.20),
        sigmoid(f.max_severity,            0.10),
    ])

    # ── Collateral Shock ────────────────────────────────────────────
    cs_score = np.mean([
        sigmoid(f.max_severity,             0.03),
        sigmoid(f.recovery_completeness,    0.70),
        sigmoid(f.early_late_ratio,         2.00, scale=2),
        inv_sigmoid(f.severity_persistence, 0.35),
    ])

    # ── Contained Stress ────────────────────────────────────────────
    ct_score = np.mean([
        sigmoid(f.max_severity,             0.01),
        inv_sigmoid(f.max_severity,         0.12),
        sigmoid(f.severity_persistence,     0.20),
        inv_sigmoid(f.recovery_completeness, 0.80),
    ])

    # ── Liquidity Dislocation ───────────────────────────────────────
    ld_score = np.mean([
        inv_sigmoid(f.max_severity,         0.03),
        inv_sigmoid(f.severity_persistence, 0.15),
        sigmoid(f.volume_spike_ratio,       4.00, scale=2),
    ])

    scores = {
        "reflexive_collapse":    round(float(rc_score), 3),
        "collateral_shock":      round(float(cs_score), 3),
        "contained_stress":      round(float(ct_score), 3),
        "liquidity_dislocation": round(float(ld_score), 3),
    }

    return scores


def get_early_warning(partial_scores: dict, threshold: float = 0.45) -> list:
    """
    Returns list of regimes approaching threshold but not yet firing.
    These are pre-signals — rising probability, not confirmed.
    """
    warnings = []
    for regime, score in partial_scores.items():
        if 0.35 <= score < threshold:
            warnings.append((regime, score))
    return sorted(warnings, key=lambda x: x[1], reverse=True)


def run_feature_engine(df: pd.DataFrame, event_key: str = "live") -> dict:
    """
    Full pipeline: raw window DataFrame → features + regime + confidence.

    Returns dict with everything needed by signal_engine.
    """
    enriched = enrich_window(df)
    features = extract_features(enriched, event_key)
    result   = classify_regime(features)
    partial  = compute_partial_confidence(features)
    warnings = get_early_warning(partial)

    return {
        "regime":          result.regime,
        "confidence_label": result.confidence,
        "rule_fired":      result.rules_fired[0] if result.rules_fired else "",
        "notes":           result.notes,
        "partial_scores":  partial,
        "early_warnings":  warnings,
        "features":        features,
        "current_price":   df["price"].iloc[-1],
        "max_severity":    features.max_severity,
        "persistence":     features.severity_persistence,
        "abandonment":     features.abandonment_signal,
    }
