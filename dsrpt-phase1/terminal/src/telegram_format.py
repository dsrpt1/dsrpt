"""
Dsrpt Terminal — Telegram Alert Formatter

Three alert states only:
  🟡 MONITOR    — elevated stress detected, watch for escalation
  🟠 ESCALATING — regime shifting, reduce exposure or tighten risk controls
  🔴 CRITICAL   — structural failure in progress, act now

Telegram message uses MarkdownV2 formatting.
Copy these templates directly into a Telegram bot send_message() call.

Design principle: traders read the first two lines and act.
Everything below is context for the curious.
"""

from datetime import datetime, timezone
from dataclasses import dataclass
from typing import Optional


@dataclass
class AlertState:
    level:        str        # MONITOR | ESCALATING | CRITICAL
    asset:        str
    timestamp:    datetime
    price:        float
    regime:       str
    confidence:   float
    tail_3pct:    float      # probability of 3% depeg payout
    tail_10pct:   float      # probability of 10% depeg payout
    lead_hours:   Optional[float] = None
    notes:        str = ""


LEVEL_EMOJI = {
    "MONITOR":    "🟡",
    "ESCALATING": "🟠",
    "CRITICAL":   "🔴",
}

REGIME_LABEL = {
    "contained_stress":      "Contained Stress",
    "reflexive_collapse":    "Reflexive Collapse",
    "collateral_shock":      "Collateral Shock",
    "liquidity_dislocation": "Liquidity Dislocation",
    "ambiguous":             "Ambiguous",
}

LP_ACTION = {
    "MONITOR":    "Hold. Monitor trajectory. No immediate action required.",
    "ESCALATING": "Reduce exposure or tighten stops. Regime shift in progress.",
    "CRITICAL":   "Exit or hedge immediately. Structural failure — no floor detected.",
}

REGIME_TO_LEVEL = {
    "contained_stress":      "MONITOR",
    "collateral_shock":      "MONITOR",
    "liquidity_dislocation": "MONITOR",
    "ambiguous":             "MONITOR",
    "reflexive_collapse":    "CRITICAL",
}


def confidence_to_level(regime: str, confidence: float, prev_regime: str = None) -> str:
    """
    Map regime + confidence to three-state alert level.
    Escalating fires when regime is transitioning or confidence is rising fast.
    """
    base = REGIME_TO_LEVEL.get(regime, "MONITOR")
    if base == "CRITICAL":
        return "CRITICAL"
    # Escalating: was stable, now showing stress signal with rising confidence
    if confidence > 0.65 and regime in ["contained_stress", "collateral_shock"]:
        if prev_regime in ["ambiguous", None]:
            return "ESCALATING"
    if confidence > 0.80:
        return "ESCALATING"
    return "MONITOR"


def format_telegram(alert: AlertState) -> str:
    """
    Format alert as Telegram MarkdownV2 message.
    First two lines are the action signal.
    Everything else is context.
    """
    emoji  = LEVEL_EMOJI[alert.level]
    regime = REGIME_LABEL.get(alert.regime, alert.regime)
    action = LP_ACTION[alert.level]
    ts_str = alert.timestamp.strftime("%Y\\-%m\\-%d %H:%M UTC")
    price  = f"{alert.price:.4f}".replace(".", "\\.")

    # Confidence bar (5 blocks = 100%)
    conf_blocks = int(alert.confidence * 5)
    conf_bar = "█" * conf_blocks + "░" * (5 - conf_blocks)

    lines = [
        f"{emoji} *DSRPT TERMINAL \\| {alert.asset}*",
        f"`{action}`",
        "",
        f"*Alert:* {alert.level}",
        f"*Regime:* {regime}",
        f"*Confidence:* {conf_bar} {alert.confidence:.0%}",
        f"*Price:* \\${price}",
        f"*Time:* {ts_str}",
        "",
        "*Tail Risk \\(implied payout probability\\):*",
        f"  3% depeg:  {alert.tail_3pct:.0f}%",
        f"  10% depeg: {alert.tail_10pct:.0f}%",
    ]

    if alert.lead_hours and alert.lead_hours > 0:
        lines += [
            "",
            f"⏱ *Lead time:* {alert.lead_hours:.0f}h before historical trough",
        ]

    if alert.notes:
        escaped = alert.notes.replace(".", "\\.").replace("-", "\\-").replace("(", "\\(").replace(")", "\\)")
        lines += ["", f"_{escaped}_"]

    lines += [
        "",
        "\\-\\-\\-",
        "[dsrpt\\.finance](https://dsrpt.finance) \\| Early warning for stablecoin LP stress",
    ]

    return "\n".join(lines)


def format_plain(alert: AlertState) -> str:
    """
    Plain text version — for console, Discord, or any non-Markdown channel.
    """
    emoji  = LEVEL_EMOJI[alert.level]
    regime = REGIME_LABEL.get(alert.regime, alert.regime)
    action = LP_ACTION[alert.level]
    ts_str = alert.timestamp.strftime("%Y-%m-%d %H:%M UTC")

    conf_blocks = int(alert.confidence * 5)
    conf_bar = "█" * conf_blocks + "░" * (5 - conf_blocks)

    lines = [
        f"{'─'*48}",
        f"{emoji}  DSRPT TERMINAL  |  {alert.asset}",
        f"{'─'*48}",
        f"  {action}",
        "",
        f"  Alert:      {alert.level}",
        f"  Regime:     {regime}",
        f"  Confidence: {conf_bar} {alert.confidence:.0%}",
        f"  Price:      ${alert.price:.4f}",
        f"  Time:       {ts_str}",
        "",
        f"  Tail Risk:",
        f"    3% depeg:  {alert.tail_3pct:.0f}%",
        f"    10% depeg: {alert.tail_10pct:.0f}%",
    ]

    if alert.lead_hours:
        lines.append(f"\n  ⏱ {alert.lead_hours:.0f}h lead time before historical trough")

    if alert.notes:
        lines.append(f"\n  {alert.notes}")

    lines.append(f"{'─'*48}")
    return "\n".join(lines)


# ─────────────────────────────────────────────
# Demo: replay the two key alert moments
# ─────────────────────────────────────────────

if __name__ == "__main__":
    print("\n=== DSRPT TERMINAL — ALERT FORMAT DEMO ===\n")

    # UST: first escalation signal — May 7 16:00 UTC at $0.984
    ust_alert = AlertState(
        level       = "ESCALATING",
        asset       = "UST/USD",
        timestamp   = datetime(2022, 5, 7, 16, 0, tzinfo=timezone.utc),
        price       = 0.9842,
        regime      = "contained_stress",
        confidence  = 0.71,
        tail_3pct   = 46,
        tail_10pct  = 15,
        lead_hours  = 141,
        notes       = "Regime shift detected: ambiguous → contained_stress. "
                      "Severity rising, recovery half-life elongating. Watch for escalation.",
    )

    # USDC: first alert — March 10 05:00 UTC at $0.985
    usdc_alert = AlertState(
        level       = "MONITOR",
        asset       = "USDC/USD",
        timestamp   = datetime(2023, 3, 10, 5, 0, tzinfo=timezone.utc),
        price       = 0.9846,
        regime      = "contained_stress",
        confidence  = 0.68,
        tail_3pct   = 32,
        tail_10pct  = 4,
        lead_hours  = 9,
        notes       = "Collateral impairment signal rising. High recovery probability — "
                      "bounded shock profile. Avoid panic exit.",
    )

    # UST: critical transition — May 10 13:00 UTC at $0.147
    ust_critical = AlertState(
        level       = "CRITICAL",
        asset       = "UST/USD",
        timestamp   = datetime(2022, 5, 10, 13, 0, tzinfo=timezone.utc),
        price       = 0.1475,
        regime      = "reflexive_collapse",
        confidence  = 0.72,
        tail_3pct   = 99,
        tail_10pct  = 95,
        notes       = "Structural failure confirmed. Volume abandonment signal active. "
                      "No price floor detected. Exit remaining exposure.",
    )

    for alert in [ust_alert, usdc_alert, ust_critical]:
        print("\n--- PLAIN TEXT ---")
        print(format_plain(alert))
        print("\n--- TELEGRAM MARKDOWN ---")
        print(format_telegram(alert))
        print()
