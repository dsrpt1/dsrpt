"""
Dsrpt Terminal — Signal Engine

Detects regime transitions and emits structured signals.

Signal types:
  TRANSITION  — regime changed from previous tick
  WARNING     — pre-signal, confidence rising toward threshold
  STABLE      — no change (logged but not emitted to user)
  COLDSTART   — first classification after warmup

Output format is deliberately plain text — this is the MVP.
Telegram/Discord formatting is a wrapper, not a dependency.
"""

import sys
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from src.scoring.curve_families import get_regime_prior_families
from src.config import ATTACHMENT_LEVELS


# Implied tail risk at key attachment levels
# Uses the best-fit curve family for the current regime
def compute_tail_risks(regime: str, partial_scores: dict) -> dict:
    """
    Quick tail risk estimate based on regime and partial confidence.
    Returns probability at each attachment level.

    In a full live system this uses the soft-prior selected curve
    evaluated at current regime confidence. For the terminal MVP,
    we use the regime's preferred family with a confidence-scaled parameter.
    """
    from src.scoring.curve_families import get_regime_prior_families
    import numpy as np

    priors = get_regime_prior_families(regime)
    if not priors:
        return {}

    # Use first curve in prior family as representative
    sample_fn = list(priors.values())[0]
    key_levels = [0.01, 0.03, 0.05, 0.10, 0.20]

    return {
        f"{int(x*100)}%": round(float(sample_fn(x)) * 100, 1)
        for x in key_levels
    }


@dataclass
class Signal:
    timestamp:      datetime
    asset:          str
    signal_type:    str          # TRANSITION | WARNING | COLDSTART | STABLE
    regime:         str
    prev_regime:    Optional[str]
    confidence:     float        # numeric 0-1 from partial scores
    rule_fired:     str
    tail_risks:     dict
    early_warnings: list
    current_price:  float
    max_severity:   float
    notes:          str


class SignalEngine:
    def __init__(self, asset: str):
        self.asset       = asset
        self.prev_regime = None
        self.prev_scores = {}
        self.tick_count  = 0
        self.signals     = []

    def process(self, timestamp: datetime, engine_result: dict) -> Optional[Signal]:
        """
        Process one feature engine result.
        Returns a Signal if something worth emitting happened.
        """
        self.tick_count += 1
        regime  = engine_result["regime"]
        partial = engine_result["partial_scores"]
        conf    = partial.get(regime, 0.5) if regime != "ambiguous" else 0.3
        warnings = engine_result["early_warnings"]

        tail_risks = compute_tail_risks(regime, partial)

        # Cold start
        if self.prev_regime is None:
            sig = Signal(
                timestamp      = timestamp,
                asset          = self.asset,
                signal_type    = "COLDSTART",
                regime         = regime,
                prev_regime    = None,
                confidence     = conf,
                rule_fired     = engine_result["rule_fired"],
                tail_risks     = tail_risks,
                early_warnings = warnings,
                current_price  = engine_result["current_price"],
                max_severity   = engine_result["max_severity"],
                notes          = engine_result["notes"],
            )
            self.prev_regime = regime
            self.prev_scores = partial
            self.signals.append(sig)
            return sig

        # Regime transition
        if regime != self.prev_regime:
            sig = Signal(
                timestamp      = timestamp,
                asset          = self.asset,
                signal_type    = "TRANSITION",
                regime         = regime,
                prev_regime    = self.prev_regime,
                confidence     = conf,
                rule_fired     = engine_result["rule_fired"],
                tail_risks     = tail_risks,
                early_warnings = warnings,
                current_price  = engine_result["current_price"],
                max_severity   = engine_result["max_severity"],
                notes          = engine_result["notes"],
            )
            self.prev_regime = regime
            self.prev_scores = partial
            self.signals.append(sig)
            return sig

        # Early warning: score rising significantly
        for w_regime, w_score in warnings:
            prev_score = self.prev_scores.get(w_regime, 0)
            if w_score - prev_score > 0.08:   # meaningful rise
                sig = Signal(
                    timestamp      = timestamp,
                    asset          = self.asset,
                    signal_type    = "WARNING",
                    regime         = w_regime,
                    prev_regime    = self.prev_regime,
                    confidence     = w_score,
                    rule_fired     = f"pre-signal: {w_regime}",
                    tail_risks     = tail_risks,
                    early_warnings = warnings,
                    current_price  = engine_result["current_price"],
                    max_severity   = engine_result["max_severity"],
                    notes          = f"Confidence rising toward {w_regime}: {prev_score:.2f} → {w_score:.2f}",
                )
                self.prev_scores = partial
                self.signals.append(sig)
                return sig

        self.prev_scores = partial
        return None   # STABLE — no emission


def format_signal(sig: Signal) -> str:
    """
    Plain text signal output — the MVP terminal format.
    Deliberately minimal. No color, no emoji dependencies.
    """
    sep = "=" * 52

    lines = [
        sep,
        f"[{sig.timestamp.strftime('%Y-%m-%d %H:%M UTC')}]  {sig.asset}",
        f"Signal: {sig.signal_type}",
    ]

    if sig.signal_type == "TRANSITION":
        lines.append(f"Regime: {sig.prev_regime} → {sig.regime}")
    else:
        lines.append(f"Regime: {sig.regime}")

    lines.append(f"Confidence: {sig.confidence:.2f}  |  Price: ${sig.current_price:.4f}")
    lines.append(f"Max severity: {sig.max_severity:.3f}")

    if sig.tail_risks:
        lines.append("")
        lines.append("Tail Risk (prob of payout at attachment):")
        for level, prob in sig.tail_risks.items():
            bar = "█" * int(prob / 5)
            lines.append(f"  {level:>4} depeg:  {prob:5.1f}%  {bar}")

    if sig.early_warnings:
        lines.append("")
        lines.append("Rising signals:")
        for w_regime, w_score in sig.early_warnings:
            lines.append(f"  {w_regime}: {w_score:.2f}")

    lines.append("")
    lines.append(f"Rule: {sig.rule_fired}")

    # LP action guidance
    action = {
        "reflexive_collapse":    "REDUCE EXPOSURE — structural failure in progress, no floor detected",
        "collateral_shock":      "HOLD / MONITOR — bounded impairment, high recovery probability",
        "contained_stress":      "MONITOR — mild persistent stress, watch for regime escalation",
        "liquidity_dislocation": "CAUTION — execution risk elevated, price impact high",
        "ambiguous":             "WATCH — insufficient signal, maintain normal risk controls",
    }.get(sig.regime, "MONITOR")

    lines.append(f"LP Action: {action}")
    lines.append(sep)

    return "\n".join(lines)
