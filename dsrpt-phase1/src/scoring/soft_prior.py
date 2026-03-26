"""
Dsrpt Phase 1 — Soft Prior Selection Engine v2.1

Replaces hard family restriction with penalty-weighted scoring.

Three selection policies compared:
  1. naive:      score(model)
  2. hard_prior: restrict candidate set to regime family, score within subset
  3. soft_prior: score(model) + λ_p · penalty(regime, family)

Soft prior formula:
  adjusted_score(m, regime) = score(m) - λ_p · penalty(regime, family(m))

Where:
  - score(m) is the tail-weighted integral score (negative = better fit)
  - penalty is a non-negative family-level cost (0 = preferred family)
  - λ_p scales the prior strength (tunable, default=0.10)

Key property:
  A strongly out-of-family model can still win if its score advantage
  exceeds the penalty. The prior guides but cannot blind the engine.

Regret measurement:
  regret(policy) = score(oracle_best) - score(policy_selected)
  Oracle = best model across all curves, no restriction.
  Lower regret = better policy.
"""

import numpy as np
import pandas as pd
from dataclasses import dataclass, field
from typing import Dict, Callable, Optional
from src.scoring.score import score_curve
from src.scoring.curve_families import get_all_families
from src.config import LAMBDA_TAIL


# ─────────────────────────────────────────────
# Penalty Matrix
# ─────────────────────────────────────────────
# Structure: regime → {family_prefix → penalty}
# 0.00 = most preferred family for this regime
# 0.10 = moderate prior against this family
# 0.25 = strong prior against this family
#
# Design principle: penalties encode economic intuition.
# They are NOT learned from data — they are explicit priors
# that should be debated, versioned, and updated deliberately.

PENALTY_MATRIX = {
    "reflexive_collapse": {
        # Death spirals: fat tail required, slow decay
        # exp_decay with low alpha = fat tail = preferred
        "exp_decay":  0.00,   # preferred — slow decay captures ongoing collapse
        "power_law":  0.03,   # reasonable — fat tail but wrong shape near 0
        "duration":   0.05,   # penalized — duration coupling not the key driver
        "piecewise":  0.08,   # penalized — breakpoint implies recovery floor
    },
    "collateral_shock": {
        # Sharp impairment: fast recovery after threshold, piecewise natural
        "piecewise":  0.00,   # preferred — breakpoint captures impairment threshold
        "power_law":  0.02,   # reasonable — fat tail but no breakpoint structure
        "exp_decay":  0.04,   # penalized — too smooth, misses threshold
        "duration":   0.06,   # penalized — duration sensitivity not key here
    },
    "contained_stress": {
        # Mild persistent: duration coupling important, no extreme tail
        "duration":   0.00,   # preferred — persistence + depth both matter
        "exp_decay":  0.02,   # reasonable — smooth decay fits mild stress
        "power_law":  0.04,   # penalized — too fat-tailed for bounded events
        "piecewise":  0.07,   # penalized — no threshold structure expected
    },
    "liquidity_dislocation": {
        # Brief, venue-specific: thin tail, fast decay
        "exp_decay":  0.00,   # preferred — high alpha, thin tail
        "piecewise":  0.03,   # reasonable — could have execution threshold
        "duration":   0.06,   # penalized — duration not the risk driver
        "power_law":  0.08,   # penalized — fat tail wrong for transient event
    },
    "ambiguous": {
        # No strong prior — minimal penalty differentiation
        # Ambiguity triggers broader search, not narrower
        "exp_decay":  0.00,
        "power_law":  0.00,
        "piecewise":  0.00,
        "duration":   0.00,
    },
}

# Hard prior family sets (for comparison — same as v1)
HARD_PRIOR_FAMILIES = {
    "reflexive_collapse":    ["exp_decay"],
    "collateral_shock":      ["piecewise", "power_law"],
    "contained_stress":      ["duration", "exp_decay"],
    "liquidity_dislocation": ["exp_decay"],
    "ambiguous":             ["exp_decay", "piecewise", "power_law", "duration"],
}


# ─────────────────────────────────────────────
# Family extractor
# ─────────────────────────────────────────────

def get_family(model_name: str) -> str:
    """Extract family prefix from model name."""
    for prefix in ["exp_decay", "piecewise", "power_law", "duration"]:
        if model_name.startswith(prefix):
            return prefix
    return "unknown"


def get_penalty(regime: str, model_name: str) -> float:
    """Look up penalty for a (regime, model) pair."""
    family  = get_family(model_name)
    regime_penalties = PENALTY_MATRIX.get(regime, PENALTY_MATRIX["ambiguous"])
    return regime_penalties.get(family, 0.05)   # default moderate penalty for unknown family


# ─────────────────────────────────────────────
# Selection Policies
# ─────────────────────────────────────────────

@dataclass
class SelectionResult:
    policy:          str
    regime:          str
    selected_model:  str
    selected_score:  float          # raw score (higher = better)
    adjusted_score:  float          # score after penalty (soft prior only)
    penalty_applied: float
    oracle_score:    float
    regret:          float          # oracle_score - selected_score (lower = better)
    candidate_count: int
    lambda_prior:    float


def select_naive(
    curves: dict,
    rl_curve: pd.DataFrame,
    lam: float = LAMBDA_TAIL,
) -> SelectionResult:
    """Policy 1: Global best — no regime information used."""
    scores = {name: score_curve(fn, rl_curve, lam=lam)["score"]
              for name, fn in curves.items()}
    best = max(scores, key=scores.get)
    oracle = best  # naive IS the oracle in this comparison

    return SelectionResult(
        policy          = "naive",
        regime          = "none",
        selected_model  = best,
        selected_score  = scores[best],
        adjusted_score  = scores[best],
        penalty_applied = 0.0,
        oracle_score    = scores[best],
        regret          = 0.0,
        candidate_count = len(curves),
        lambda_prior    = 0.0,
    )


def select_hard_prior(
    curves: dict,
    rl_curve: pd.DataFrame,
    regime: str,
    lam: float = LAMBDA_TAIL,
) -> SelectionResult:
    """Policy 2: Restrict search to hard prior family set."""
    allowed_families = HARD_PRIOR_FAMILIES.get(regime, list(HARD_PRIOR_FAMILIES["ambiguous"]))
    subset = {name: fn for name, fn in curves.items()
              if get_family(name) in allowed_families}
    if not subset:
        subset = curves   # fallback to full set

    # Oracle score (global best, for regret calculation)
    all_scores = {name: score_curve(fn, rl_curve, lam=lam)["score"]
                  for name, fn in curves.items()}
    oracle_model = max(all_scores, key=all_scores.get)

    subset_scores = {name: all_scores[name] for name in subset}
    best = max(subset_scores, key=subset_scores.get)

    return SelectionResult(
        policy          = "hard_prior",
        regime          = regime,
        selected_model  = best,
        selected_score  = subset_scores[best],
        adjusted_score  = subset_scores[best],
        penalty_applied = 0.0,
        oracle_score    = all_scores[oracle_model],
        regret          = all_scores[oracle_model] - subset_scores[best],
        candidate_count = len(subset),
        lambda_prior    = 0.0,
    )


def select_soft_prior(
    curves: dict,
    rl_curve: pd.DataFrame,
    regime: str,
    lambda_prior: float = 0.10,
    lam: float = LAMBDA_TAIL,
) -> SelectionResult:
    """
    Policy 3: Soft-prior adjusted scoring.

    adjusted_score(m) = score(m) - lambda_prior * penalty(regime, family(m))

    Note: score is negative (lower magnitude = better fit).
    Penalty subtracts from score (makes it more negative = worse).
    So penalized families must have proportionally better raw scores to win.
    """
    raw_scores = {name: score_curve(fn, rl_curve, lam=lam)["score"]
                  for name, fn in curves.items()}

    # Oracle = global best raw score
    oracle_model = max(raw_scores, key=raw_scores.get)

    # Adjusted scores
    adjusted = {
        name: raw_scores[name] - lambda_prior * get_penalty(regime, name)
        for name in raw_scores
    }
    best = max(adjusted, key=adjusted.get)

    return SelectionResult(
        policy          = "soft_prior",
        regime          = regime,
        selected_model  = best,
        selected_score  = raw_scores[best],
        adjusted_score  = adjusted[best],
        penalty_applied = get_penalty(regime, best),
        oracle_score    = raw_scores[oracle_model],
        regret          = raw_scores[oracle_model] - raw_scores[best],
        candidate_count = len(curves),
        lambda_prior    = lambda_prior,
    )


# ─────────────────────────────────────────────
# Lambda Prior Sweep
# ─────────────────────────────────────────────

LAMBDA_PRIOR_SWEEP = [0.01, 0.03, 0.05, 0.10, 0.20, 0.50]

def sweep_lambda_prior(
    curves: dict,
    rl_curve: pd.DataFrame,
    regime: str,
    lam: float = LAMBDA_TAIL,
) -> pd.DataFrame:
    """
    Test soft prior across lambda_prior values.
    Reveals how aggressively the prior needs to weight before model selection shifts.
    """
    rows = []
    for lp in LAMBDA_PRIOR_SWEEP:
        result = select_soft_prior(curves, rl_curve, regime, lambda_prior=lp, lam=lam)
        rows.append({
            "lambda_prior":    lp,
            "selected_model":  result.selected_model,
            "family":          get_family(result.selected_model),
            "raw_score":       round(result.selected_score, 6),
            "adjusted_score":  round(result.adjusted_score, 6),
            "regret":          round(result.regret, 6),
            "penalty":         round(result.penalty_applied, 4),
        })
    return pd.DataFrame(rows)


# ─────────────────────────────────────────────
# Three-Way Comparison
# ─────────────────────────────────────────────

def three_way_comparison(
    curves: dict,
    rl_surfaces: dict,
    regime_results: dict,
    lambda_prior: float = 0.10,
    lam: float = LAMBDA_TAIL,
) -> pd.DataFrame:
    """
    Run all three policies on all events.
    Returns comparison DataFrame with regret as the key metric.
    """
    rows = []
    for ek, rl in rl_surfaces.items():
        regime = regime_results[ek].regime

        r_naive = select_naive(curves, rl, lam=lam)
        r_hard  = select_hard_prior(curves, rl, regime, lam=lam)
        r_soft  = select_soft_prior(curves, rl, regime, lambda_prior, lam=lam)

        rows.append({
            "event":                ek,
            "regime":               regime,
            # Naive
            "naive_model":          r_naive.selected_model,
            "naive_score":          round(r_naive.selected_score, 6),
            "naive_regret":         round(r_naive.regret, 6),
            # Hard prior
            "hard_model":           r_hard.selected_model,
            "hard_score":           round(r_hard.selected_score, 6),
            "hard_regret":          round(r_hard.regret, 6),
            "hard_pool":            r_hard.candidate_count,
            # Soft prior
            "soft_model":           r_soft.selected_model,
            "soft_score":           round(r_soft.selected_score, 6),
            "soft_regret":          round(r_soft.regret, 6),
            "soft_lambda":          lambda_prior,
            # Winner
            "best_policy":          min(
                [("naive", r_naive.regret), ("hard", r_hard.regret), ("soft", r_soft.regret)],
                key=lambda x: x[1]
            )[0],
        })

    df = pd.DataFrame(rows)

    # Summary row
    summary = {
        "event": "MEAN_REGRET",
        "regime": "—",
        "naive_regret":  round(df["naive_regret"].mean(), 6),
        "hard_regret":   round(df["hard_regret"].mean(), 6),
        "soft_regret":   round(df["soft_regret"].mean(), 6),
        "best_policy":   min(
            [("naive", df["naive_regret"].mean()),
             ("hard",  df["hard_regret"].mean()),
             ("soft",  df["soft_regret"].mean())],
            key=lambda x: x[1]
        )[0],
    }
    return df, summary
