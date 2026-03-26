"""
Dsrpt Phase 1 — Sensitivity Analysis

Tests whether model rankings are robust to reasonable perturbations of:
  1. Tail-weight parameter λ
  2. Attachment grid density
  3. Liquidity adjustment scheme
  4. Duration threshold

Pass criterion: top-3 ranking is directionally stable under all perturbations.
Fail criterion: rank of best model changes by more than 2 positions under any perturbation.
"""

import numpy as np
import pandas as pd
from copy import deepcopy
from src.scoring.score import score_curve, rank_curves
from src.scoring.curve_families import get_all_families
from src.pipeline.rl_surface import (
    compute_depeg_severity, compute_adjusted_severity,
    compute_duration_function, compute_rl_curve
)
from src.config import ATTACHMENT_LEVELS, LAMBDA_TAIL


# ─────────────────────────────────────────────
# Perturbation Specs
# ─────────────────────────────────────────────

LAMBDA_SWEEP      = [0.5, 1.0, 2.0, 3.0, 5.0, 8.0]     # default=3.0
ATTACHMENT_GRIDS  = {
    "coarse":  [0.005, 0.01, 0.03, 0.05, 0.10, 0.20, 0.50],
    "default": ATTACHMENT_LEVELS,
    "fine":    [0.002, 0.005, 0.01, 0.015, 0.02, 0.03, 0.05, 0.075, 0.10, 0.15, 0.20, 0.30, 0.40, 0.50],
}
LIQUIDITY_SCHEMES = ["volume_normalized", "uniform", "volume_sqrt"]
DURATION_THRESHOLDS = [0.5, 1.0, 2.0, 4.0]  # hours


# ─────────────────────────────────────────────
# Helpers — RL Reconstruction Under Perturbation
# ─────────────────────────────────────────────

def build_rl_with_params(
    raw_df: pd.DataFrame,
    event_cfg: dict,
    attachment_levels: list = None,
    liquidity_scheme: str = "volume_normalized",
    duration_threshold_h: float = None,
) -> pd.DataFrame:
    """Rebuild RL curve with specific perturbation parameters."""
    if attachment_levels is None:
        attachment_levels = ATTACHMENT_LEVELS
    if duration_threshold_h is None:
        duration_threshold_h = event_cfg.get("payout_duration_threshold_hours", 1.0)

    df = compute_depeg_severity(raw_df.copy())

    # Liquidity scheme
    if liquidity_scheme == "uniform":
        df["liquidity_weight"] = 1.0
    elif liquidity_scheme == "volume_sqrt":
        max_vol = df["volume"].max()
        df["liquidity_weight"] = np.sqrt(df["volume"] / max_vol).clip(0.01, 1.0) if max_vol > 0 else 1.0
    else:  # volume_normalized (default)
        max_vol = df["volume"].max()
        df["liquidity_weight"] = (df["volume"] / max_vol).clip(0.01, 1.0) if max_vol > 0 else 1.0

    df = compute_adjusted_severity(df)

    # Temporarily override duration threshold
    modified_cfg = dict(event_cfg)
    modified_cfg["payout_duration_threshold_hours"] = duration_threshold_h

    durations = compute_duration_function(df, attachment_levels)
    rl_curve  = compute_rl_curve(durations, modified_cfg, attachment_levels)
    return rl_curve


# ─────────────────────────────────────────────
# Sensitivity Sweep
# ─────────────────────────────────────────────

def sweep_lambda(
    curves: dict,
    rl_curve: pd.DataFrame,
    lambdas: list = LAMBDA_SWEEP,
    top_n: int = 5,
) -> pd.DataFrame:
    """Test ranking stability across tail-weight values."""
    rows = []
    for lam in lambdas:
        results = []
        for name, fn in curves.items():
            res = score_curve(fn, rl_curve, lam=lam)
            results.append({"model": name, "score": res["score"]})
        ranked = sorted(results, key=lambda r: r["score"], reverse=True)
        for rank, r in enumerate(ranked[:top_n], 1):
            rows.append({"lambda": lam, "rank": rank, "model": r["model"], "score": round(r["score"], 6)})
    return pd.DataFrame(rows)


def sweep_attachment_grid(
    curves: dict,
    raw_df: pd.DataFrame,
    event_cfg: dict,
    grids: dict = None,
    lam: float = LAMBDA_TAIL,
    top_n: int = 5,
) -> pd.DataFrame:
    if grids is None:
        grids = ATTACHMENT_GRIDS
    rows = []
    for grid_name, grid in grids.items():
        rl = build_rl_with_params(raw_df, event_cfg, attachment_levels=grid)
        results = []
        for name, fn in curves.items():
            res = score_curve(fn, rl, lam=lam)
            results.append({"model": name, "score": res["score"]})
        ranked = sorted(results, key=lambda r: r["score"], reverse=True)
        for rank, r in enumerate(ranked[:top_n], 1):
            rows.append({"grid": grid_name, "rank": rank, "model": r["model"], "score": round(r["score"], 6)})
    return pd.DataFrame(rows)


def sweep_liquidity_scheme(
    curves: dict,
    raw_df: pd.DataFrame,
    event_cfg: dict,
    schemes: list = None,
    lam: float = LAMBDA_TAIL,
    top_n: int = 5,
) -> pd.DataFrame:
    if schemes is None:
        schemes = LIQUIDITY_SCHEMES
    rows = []
    for scheme in schemes:
        rl = build_rl_with_params(raw_df, event_cfg, liquidity_scheme=scheme)
        results = []
        for name, fn in curves.items():
            res = score_curve(fn, rl, lam=lam)
            results.append({"model": name, "score": res["score"]})
        ranked = sorted(results, key=lambda r: r["score"], reverse=True)
        for rank, r in enumerate(ranked[:top_n], 1):
            rows.append({"scheme": scheme, "rank": rank, "model": r["model"], "score": round(r["score"], 6)})
    return pd.DataFrame(rows)


def sweep_duration_threshold(
    curves: dict,
    raw_df: pd.DataFrame,
    event_cfg: dict,
    thresholds: list = None,
    lam: float = LAMBDA_TAIL,
    top_n: int = 5,
) -> pd.DataFrame:
    if thresholds is None:
        thresholds = DURATION_THRESHOLDS
    rows = []
    for thresh in thresholds:
        rl = build_rl_with_params(raw_df, event_cfg, duration_threshold_h=thresh)
        results = []
        for name, fn in curves.items():
            res = score_curve(fn, rl, lam=lam)
            results.append({"model": name, "score": res["score"]})
        ranked = sorted(results, key=lambda r: r["score"], reverse=True)
        for rank, r in enumerate(ranked[:top_n], 1):
            rows.append({"threshold_h": thresh, "rank": rank, "model": r["model"], "score": round(r["score"], 6)})
    return pd.DataFrame(rows)


# ─────────────────────────────────────────────
# Stability Diagnostic
# ─────────────────────────────────────────────

def compute_rank_stability(sweep_df: pd.DataFrame, dim_col: str, top_n: int = 3) -> dict:
    """
    Given a sweep DataFrame, compute:
      - Whether the top-N models are consistent across perturbations
      - Rank variance for the best model
      - Pass/fail flag
    """
    top_models_per_dim = {}
    for dim_val, group in sweep_df.groupby(dim_col):
        top_models = set(group[group["rank"] <= top_n]["model"].tolist())
        top_models_per_dim[dim_val] = top_models

    # Intersection: models consistently in top-N across ALL perturbations
    all_sets = list(top_models_per_dim.values())
    stable_top = all_sets[0].copy()
    for s in all_sets[1:]:
        stable_top &= s

    # Best model rank variance
    best_model = sweep_df[sweep_df["rank"] == 1]["model"].mode()
    best_model = best_model.iloc[0] if len(best_model) > 0 else "unknown"
    best_ranks = sweep_df[sweep_df["model"] == best_model]["rank"].values
    rank_variance = float(np.var(best_ranks)) if len(best_ranks) > 1 else 0.0

    passed = len(stable_top) > 0 and rank_variance < 2.0

    return {
        "stable_top_models": list(stable_top),
        "best_model":        best_model,
        "rank_variance":     round(rank_variance, 3),
        "passed":            passed,
        "verdict":           "STABLE" if passed else "UNSTABLE — ranking is sensitive to construction choices",
    }


def run_full_sensitivity(
    raw_df: pd.DataFrame,
    event_key: str,
    event_cfg: dict,
    rl_curve: pd.DataFrame,
    curves: dict,
    top_n: int = 5,
) -> dict:
    """
    Run all four sensitivity sweeps for one event.
    Returns dict of sweep DataFrames + stability verdicts.
    """
    print(f"    λ sweep...")
    lam_df     = sweep_lambda(curves, rl_curve, top_n=top_n)
    print(f"    attachment grid sweep...")
    grid_df    = sweep_attachment_grid(curves, raw_df, event_cfg, top_n=top_n)
    print(f"    liquidity scheme sweep...")
    liq_df     = sweep_liquidity_scheme(curves, raw_df, event_cfg, top_n=top_n)
    print(f"    duration threshold sweep...")
    dur_df     = sweep_duration_threshold(curves, raw_df, event_cfg, top_n=top_n)

    return {
        "lambda_sweep":       (lam_df,  compute_rank_stability(lam_df,  "lambda",      top_n)),
        "grid_sweep":         (grid_df, compute_rank_stability(grid_df, "grid",         top_n)),
        "liquidity_sweep":    (liq_df,  compute_rank_stability(liq_df,  "scheme",       top_n)),
        "duration_sweep":     (dur_df,  compute_rank_stability(dur_df,  "threshold_h",  top_n)),
    }
