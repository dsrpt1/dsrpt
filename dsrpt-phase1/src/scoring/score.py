"""
Dsrpt Phase 1 — Tail-Weighted Scoring Function

score = -∫ w(x) · (EL(x) - RL(x))² dx

where w(x) = exp(λ · x) — exponential tail weighting

This penalizes tail misses non-linearly.
A model that nails shallow depegs but misses the 20% tail
scores far worse than its MSE would suggest.
"""

import numpy as np
import pandas as pd
from scipy import integrate
from src.config import LAMBDA_TAIL, ATTACHMENT_LEVELS


# ─────────────────────────────────────────────
# Hazard Curve Shapes (Test Models)
# ─────────────────────────────────────────────

def flat_curve(x: float, base_prob: float = 0.05) -> float:
    """Naive: constant probability across all attachment levels."""
    return base_prob


def steep_curve(x: float, scale: float = 2.0) -> float:
    """Overestimates tail risk — paranoid model."""
    return np.exp(-scale * x)


def convex_curve(x: float, k: float = 10.0, x0: float = 0.05) -> float:
    """Logistic decay — assigns most risk to shallow depegs."""
    return 1.0 / (1.0 + np.exp(k * (x - x0)))


def power_law_curve(x: float, alpha: float = 1.5) -> float:
    """Power law decay — fat-tailed prior."""
    return min(1.0, (0.01 / max(x, 0.001)) ** alpha)


def calibrated_curve(x: float, event_key: str = "USDC_2023") -> float:
    """
    Event-specific calibrated curve.
    In production: this is what your HazardCurveEngine outputs.
    These are manually calibrated approximations for Phase 1 testing.
    """
    params = {
        "UST_2022":  {"scale": 0.8,  "shift": 0.02},   # death spiral: steep
        "USDC_2023": {"scale": 3.0,  "shift": 0.05},   # sharp + quick recovery
        "FRAX_2023": {"scale": 4.0,  "shift": 0.04},   # contained stress
    }
    p = params.get(event_key, {"scale": 2.0, "shift": 0.03})
    return np.exp(-p["scale"] * (x - p["shift"])) if x > p["shift"] else 1.0


CURVES = {
    "flat":        lambda x: flat_curve(x),
    "steep":       lambda x: steep_curve(x),
    "convex":      lambda x: convex_curve(x),
    "power_law":   lambda x: power_law_curve(x),
}


# ─────────────────────────────────────────────
# Tail Weight Function
# ─────────────────────────────────────────────

def tail_weight(x: float, lam: float = LAMBDA_TAIL) -> float:
    """
    w(x) = exp(λ · x)
    
    λ=3.0 means a 50% depeg attachment is weighted ~e^1.5 ≈ 4.5x
    more heavily than a 1% attachment.
    
    Calibration note: higher λ → more aggressive tail penalty.
    For production, λ should be calibrated to actual capital-at-risk curves.
    """
    return np.exp(lam * x)


# ─────────────────────────────────────────────
# Scoring Function
# ─────────────────────────────────────────────

def score_curve(
    el_func,
    rl_curve: pd.DataFrame,
    lam: float = LAMBDA_TAIL,
) -> dict:
    """
    Compute tail-weighted score for a predicted EL curve against realized RL.
    
    Returns dict with:
      - score: the (negated) integral — higher is better
      - mse_unweighted: for comparison
      - el_values: predicted probabilities at each attachment level
      - rl_values: realized probabilities
      - weighted_errors: per-attachment weighted squared errors
    """
    attachments = rl_curve["attachment"].values
    rl_vals     = rl_curve["rl_prob"].values

    el_vals     = np.array([el_func(x) for x in attachments])
    errors      = (el_vals - rl_vals) ** 2
    weights     = np.array([tail_weight(x, lam) for x in attachments])
    w_errors    = weights * errors

    # Numerical integration via trapezoidal rule
    trapz = getattr(np, "trapezoid", getattr(np, "trapz", None))
    integral      = trapz(w_errors, attachments)
    mse_unweighted = trapz(errors,  attachments)

    return {
        "score":             -integral,          # higher = better
        "weighted_integral":  integral,
        "mse_unweighted":     mse_unweighted,
        "attachments":        attachments,
        "el_values":          el_vals,
        "rl_values":          rl_vals,
        "weights":            weights,
        "weighted_errors":    w_errors,
    }


def rank_curves(curves: dict, rl_curve: pd.DataFrame, event_key: str = "") -> pd.DataFrame:
    """
    Score and rank all candidate curves against a realized loss surface.
    Returns sorted DataFrame — highest score = best model.
    """
    # Add event-specific calibrated curve if event_key provided
    all_curves = dict(curves)
    if event_key:
        all_curves[f"calibrated_{event_key}"] = lambda x, ek=event_key: calibrated_curve(x, ek)

    rows = []
    for name, fn in all_curves.items():
        result = score_curve(fn, rl_curve)
        rows.append({
            "model":             name,
            "score":             round(result["score"], 6),
            "mse_unweighted":    round(result["mse_unweighted"], 6),
            "weighted_integral": round(result["weighted_integral"], 6),
        })

    return pd.DataFrame(rows).sort_values("score", ascending=False).reset_index(drop=True)
