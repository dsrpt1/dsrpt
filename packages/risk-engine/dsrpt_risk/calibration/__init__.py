"""
Calibration modules for DSRPT Risk Engine.

Modules:
- hazard: Hazard curve calibration from EVT + Hawkes models
- validation: Monte Carlo validation of calibrated curves
"""

from dsrpt_risk.calibration.hazard import HazardCalibrator, HazardCurve, RegimeCurveSet
from dsrpt_risk.calibration.validation import CurveValidator

__all__ = [
    "HazardCalibrator",
    "HazardCurve",
    "RegimeCurveSet",
    "CurveValidator",
]
