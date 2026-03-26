"""
Dsrpt Phase 1 — Parametric Curve Families

Replaces fixed named curves (flat/steep/convex/power_law) with
tunable families. Each family is parameterized so we can:
  1. Grid-search best-fit parameters per event
  2. Test whether parameter regions cluster by regime
  3. Eventually let the model market submit (family, params) pairs

Families:
  A. ExponentialDecay      EL(x) = exp(-α·x)                        α ∈ [0.5, 20]
  B. PiecewiseHazard       EL(x) = {1 if x<b; exp(-α·(x-b)) if x≥b} b ∈ attachment range
  C. PowerLaw              EL(x) = (x0/x)^α                         α ∈ [0.5, 5], x0 fixed
  D. DurationCoupled       EL(x) = exp(-α·x) · sigmoid(β·(x-γ))     adds duration sensitivity
"""

import numpy as np
from dataclasses import dataclass
from typing import Callable, Dict, Any


# ─────────────────────────────────────────────
# Family A: Exponential Decay
# ─────────────────────────────────────────────

def exp_decay(x: float, alpha: float = 5.0) -> float:
    """
    EL(x) = exp(-α·x)
    α controls steepness. Low α = fat tail. High α = thin tail.
    """
    return float(np.exp(-alpha * x))


def exp_decay_family(alpha_values=None):
    if alpha_values is None:
        alpha_values = [0.5, 1.0, 2.0, 5.0, 10.0, 20.0]
    return {
        f"exp_decay_α={a}": (lambda x, a=a: exp_decay(x, a))
        for a in alpha_values
    }


# ─────────────────────────────────────────────
# Family B: Piecewise Hazard
# ─────────────────────────────────────────────

def piecewise_hazard(x: float, breakpoint: float = 0.05, alpha: float = 5.0) -> float:
    """
    EL(x) = 1.0              if x < breakpoint
    EL(x) = exp(-α·(x-b))   if x >= breakpoint

    Models: "high probability of shallow depeg, but tail decays once
    structural threshold is crossed."
    
    b (breakpoint) = attachment level where structural risk changes regime.
    """
    if x < breakpoint:
        return 1.0
    return float(np.exp(-alpha * (x - breakpoint)))


def piecewise_family(breakpoints=None, alphas=None):
    if breakpoints is None:
        breakpoints = [0.01, 0.03, 0.05, 0.10]
    if alphas is None:
        alphas = [2.0, 5.0, 10.0]
    curves = {}
    for b in breakpoints:
        for a in alphas:
            curves[f"piecewise_b={b}_α={a}"] = (lambda x, b=b, a=a: piecewise_hazard(x, b, a))
    return curves


# ─────────────────────────────────────────────
# Family C: Power Law
# ─────────────────────────────────────────────

def power_law(x: float, alpha: float = 1.5, x0: float = 0.005) -> float:
    """
    EL(x) = min(1, (x0/x)^α)
    Fat-tailed prior. x0 = reference attachment level (usually minimum).
    """
    return float(min(1.0, (x0 / max(x, x0 * 0.01)) ** alpha))


def power_law_family(alphas=None):
    if alphas is None:
        alphas = [0.5, 1.0, 1.5, 2.0, 3.0, 5.0]
    return {
        f"power_law_α={a}": (lambda x, a=a: power_law(x, a))
        for a in alphas
    }


# ─────────────────────────────────────────────
# Family D: Duration-Coupled
# ─────────────────────────────────────────────

def duration_coupled(x: float, alpha: float = 5.0, beta: float = 20.0, gamma: float = 0.05) -> float:
    """
    EL(x) = exp(-α·x) × σ(β·(γ-x))
    
    σ(z) = 1 / (1 + exp(-z)) — sigmoid
    
    Intuition: At low attachment levels, probability is high and
    sigmoid ≈ 1. At high attachment (x >> γ), sigmoid suppresses,
    modeling that extreme tail events require both depth AND duration.
    
    γ = inflection point (attachment level where duration constraint kicks in)
    β = sharpness of duration transition
    """
    decay   = np.exp(-alpha * x)
    sigmoid = 1.0 / (1.0 + np.exp(-beta * (gamma - x)))
    return float(decay * sigmoid)


def duration_coupled_family(alphas=None, gammas=None):
    if alphas is None:
        alphas = [2.0, 5.0, 10.0]
    if gammas is None:
        gammas = [0.02, 0.05, 0.10]
    curves = {}
    for a in alphas:
        for g in gammas:
            curves[f"duration_α={a}_γ={g}"] = (lambda x, a=a, g=g: duration_coupled(x, a, 20.0, g))
    return curves


# ─────────────────────────────────────────────
# Full Family Registry
# ─────────────────────────────────────────────

def get_all_families(grid: str = "medium") -> Dict[str, Callable]:
    """
    Returns all curve families merged.
    grid: "coarse" | "medium" | "fine"
    """
    if grid == "coarse":
        exp    = exp_decay_family([1.0, 5.0, 15.0])
        pw     = piecewise_family([0.02, 0.05], [3.0, 8.0])
        pl     = power_law_family([1.0, 2.0])
        dc     = duration_coupled_family([3.0], [0.03, 0.07])
    elif grid == "fine":
        exp    = exp_decay_family([0.5, 1.0, 2.0, 3.0, 5.0, 8.0, 12.0, 20.0])
        pw     = piecewise_family([0.01, 0.02, 0.03, 0.05, 0.08, 0.10], [2.0, 4.0, 6.0, 10.0])
        pl     = power_law_family([0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0])
        dc     = duration_coupled_family([2.0, 4.0, 6.0, 10.0], [0.02, 0.04, 0.07, 0.10])
    else:  # medium
        exp    = exp_decay_family([0.5, 1.0, 2.0, 5.0, 10.0, 20.0])
        pw     = piecewise_family([0.01, 0.03, 0.05, 0.10], [2.0, 5.0, 10.0])
        pl     = power_law_family([0.5, 1.0, 1.5, 2.0, 3.0, 5.0])
        dc     = duration_coupled_family([2.0, 5.0, 10.0], [0.02, 0.05, 0.10])

    return {**exp, **pw, **pl, **dc}


def get_regime_prior_families(regime: str) -> Dict[str, Callable]:
    """
    Returns the curve families most theoretically appropriate for each regime.
    Used to test: does regime-conditioned selection outperform naive ranking?
    """
    priors = {
        "reflexive_collapse":    exp_decay_family([0.5, 1.0, 2.0]),      # slow decay = fat tail
        "collateral_shock":      piecewise_family([0.03, 0.08], [5.0, 10.0]),  # sharp threshold
        "contained_stress":      duration_coupled_family([3.0, 5.0], [0.03, 0.05]),
        "liquidity_dislocation": exp_decay_family([8.0, 15.0]),           # thin tail
        "ambiguous":             get_all_families("coarse"),
    }
    return priors.get(regime, get_all_families("coarse"))
