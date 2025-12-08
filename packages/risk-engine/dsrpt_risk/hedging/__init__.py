"""
Meta-Hedging module for DSRPT Risk Engine.

Implements hedging strategies to stabilize underwriting P&L by taking
opposing positions in risk factors that drive premium pricing.

Key Concept:
------------
Premium income varies with market conditions (volatility, liquidity, stress).
By taking derivative positions that profit when premium income drops,
total income (premiums + hedge P&L) becomes more stable.

Example:
- High volatility → High premiums → Long vol position loses
- Low volatility → Low premiums → Long vol position gains
- Net result: Stable total income regardless of volatility regime
"""

from dsrpt_risk.hedging.positions import MetaHedger, HedgePosition, HedgeType

__all__ = [
    "MetaHedger",
    "HedgePosition",
    "HedgeType",
]
