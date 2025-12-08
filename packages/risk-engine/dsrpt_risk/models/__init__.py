"""
Statistical models for DSRPT Risk Engine.

Models:
- EVTModel: Extreme Value Theory for tail risk modeling
- HawkesProcess: Self-exciting point process for event clustering
- RegimeClassifier: Hidden Markov Model for market regime detection
"""

from dsrpt_risk.models.evt import EVTModel, GPDParams, GEVParams
from dsrpt_risk.models.hawkes import HawkesProcess, HawkesParams
from dsrpt_risk.models.regime import RegimeClassifier, RegimeKind

__all__ = [
    "EVTModel",
    "GPDParams",
    "GEVParams",
    "HawkesProcess",
    "HawkesParams",
    "RegimeClassifier",
    "RegimeKind",
]
