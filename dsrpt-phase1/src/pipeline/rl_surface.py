"""
Dsrpt Phase 1 — Realized Loss Surface Pipeline

Constructs RL(x) for each event:
  - Depeg severity time series
  - Liquidity-adjusted severity (I*)
  - Duration function D(x)
  - Realized Loss Curve RL(x)
"""

import numpy as np
import pandas as pd
from typing import Tuple
from src.config import ATTACHMENT_LEVELS, LIQUIDITY_WEIGHT_FLOOR


# ─────────────────────────────────────────────
# Step 1: Depeg Severity
# ─────────────────────────────────────────────

def compute_depeg_severity(df: pd.DataFrame) -> pd.DataFrame:
    """
    I(t) = max(0, 1 - price(t))
    Raw depeg severity at each timestamp.
    """
    df = df.copy()
    df["severity"] = np.maximum(0.0, 1.0 - df["price"])
    return df


# ─────────────────────────────────────────────
# Step 2: Liquidity Weight
# ─────────────────────────────────────────────

def compute_liquidity_weight(df: pd.DataFrame) -> pd.DataFrame:
    """
    Normalize volume to [FLOOR, 1.0] as a proxy for liquidity depth.

    IMPORTANT — Volume collapse asymmetry:
    Volume crashes in TWO structurally different situations:
      A. Post-recovery: asset returns to peg, trading normalizes → suppress severity (correct)
      B. Terminal abandonment: asset is dead, no one trades → volume crash does NOT
         mean recovery, it means the market gave up. Suppressing severity here is wrong.

    Fix: liquidity weight uses a ROLLING WINDOW maximum rather than the global max.
    This means weight is always relative to recent activity, not peak panic volume.
    A dying asset with low-but-stable volume gets weight ≈ 1.0 relative to itself.

    The distinction between A and B must ultimately come from the price path itself
    (terminal severity in raw severity, not adjusted). The trajectory features
    therefore compute terminal_severity and recovery_completeness on BOTH
    raw_severity and adjusted_severity — the delta between them is informative.

    Production upgrade: replace with actual on-chain depth from Curve/Uniswap v3.
    """
    df = df.copy()

    # Rolling 24h window max volume, then normalize
    # This prevents late-window volume collapse from artificially suppressing severity
    window = min(24, max(1, len(df) // 6))
    rolling_max = df["volume"].rolling(window=window, min_periods=1).max()

    max_vol = df["volume"].max()
    if max_vol == 0:
        df["liquidity_weight"] = 1.0
    else:
        # Use rolling max for normalization (suppresses only genuine recovery, not abandonment)
        rolling_norm = df["volume"] / rolling_max.clip(lower=max_vol * 0.01)
        df["liquidity_weight"] = np.maximum(rolling_norm, LIQUIDITY_WEIGHT_FLOOR).clip(upper=1.0)

    return df


# ─────────────────────────────────────────────
# Step 3: Liquidity-Adjusted Severity
# ─────────────────────────────────────────────

def compute_adjusted_severity(df: pd.DataFrame) -> pd.DataFrame:
    """
    I*(t) = I(t) × liquidity_weight(t)
    
    Captures: you can only lose money at prices you can actually execute.
    A 50% depeg with zero liquidity = no realized loss.
    """
    df = df.copy()
    df["adjusted_severity"] = df["severity"] * df["liquidity_weight"]
    return df


# ─────────────────────────────────────────────
# Step 4: Duration Function D(x)
# ─────────────────────────────────────────────

def compute_duration_function(
    df: pd.DataFrame,
    attachment_levels: list = ATTACHMENT_LEVELS
) -> dict:
    """
    D(x) = total hours where I*(t) >= x
    
    This is the path-dependent core: a momentary spike vs sustained depeg
    produce radically different D(x) profiles.
    """
    durations = {}
    
    # Estimate hours per row (variable interval safe)
    if len(df) > 1:
        ts = df["timestamp"].sort_values()
        intervals = ts.diff().dropna().dt.total_seconds() / 3600
        avg_interval_hours = intervals.median()
    else:
        avg_interval_hours = 1.0

    for x in attachment_levels:
        rows_above = (df["adjusted_severity"] >= x).sum()
        durations[x] = rows_above * avg_interval_hours

    return durations


# ─────────────────────────────────────────────
# Step 5: Realized Loss Curve RL(x)
# ─────────────────────────────────────────────

def compute_rl_curve(
    durations: dict,
    event_cfg: dict,
    attachment_levels: list = ATTACHMENT_LEVELS
) -> pd.DataFrame:
    """
    RL(x) = payout probability at attachment level x
    
    Payout triggers if:
      - adjusted severity >= x  AND
      - duration >= threshold (event-specific)
    
    RL(x) = D(x) / total_event_hours  (clamped to [0,1])
    
    This produces a probability-of-trigger curve across attachment levels,
    which is what the scoring function compares against EL(x).
    """
    threshold_hours = event_cfg.get("payout_duration_threshold_hours", 1.0)
    
    # Total observation window in hours
    start = pd.Timestamp(event_cfg["start"], tz="UTC")
    end   = pd.Timestamp(event_cfg["end"],   tz="UTC")
    total_hours = (end - start).total_seconds() / 3600

    records = []
    for x in attachment_levels:
        d = durations.get(x, 0.0)
        # RL = fraction of window where this attachment level was breached
        # above threshold → treat as "triggered" at this level
        triggered = 1.0 if d >= threshold_hours else 0.0
        rl_prob   = min(d / total_hours, 1.0)  # continuous probability
        
        records.append({
            "attachment": x,
            "duration_hours": d,
            "triggered": triggered,
            "rl_prob": rl_prob,
        })

    return pd.DataFrame(records)


# ─────────────────────────────────────────────
# Full Pipeline
# ─────────────────────────────────────────────

def build_realized_loss_surface(
    raw_df: pd.DataFrame,
    event_cfg: dict,
    attachment_levels: list = ATTACHMENT_LEVELS
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """
    Full pipeline: raw price/volume → RL(x) curve
    
    Returns:
      - enriched_df: timestep-level data with severity, weights, etc.
      - rl_curve:    attachment-level RL curve
    """
    df = compute_depeg_severity(raw_df)
    df = compute_liquidity_weight(df)
    df = compute_adjusted_severity(df)

    durations = compute_duration_function(df, attachment_levels)
    rl_curve  = compute_rl_curve(durations, event_cfg, attachment_levels)

    return df, rl_curve
