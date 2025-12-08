"""
DSRPT Risk Engine
================

Off-chain risk modeling and calibration engine for the DSRPT Protocol.

Modules:
--------
- models: Statistical models (EVT, Hawkes, HMM regime classifier)
- calibration: Hazard curve calibration and validation
- hedging: Meta-hedging position manager
- data: Price feed aggregation and storage
- utils: Common utilities and Web3 integration

Example Usage:
-------------
```python
from dsrpt_risk import RiskEngine, RegimeClassifier, HazardCalibrator

# Initialize engine
engine = RiskEngine.from_config("config.yaml")

# Classify current market regime
regime = engine.classify_regime()

# Calibrate hazard curves for each regime
curves = engine.calibrate_hazard_curves()

# Generate on-chain transaction
tx = engine.generate_curve_update_tx(curves)
```
"""

__version__ = "0.1.0"
__author__ = "DSRPT Protocol"

from dsrpt_risk.config import Config, load_config
from dsrpt_risk.engine import RiskEngine

__all__ = [
    "Config",
    "load_config",
    "RiskEngine",
    "__version__",
]
