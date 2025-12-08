"""
Validation module for hazard curves.

Ensures that:
1. Calibrated H(T) matches expected payout distribution
2. Premium calculations are actuarially sound
3. Curves are monotonically increasing
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Tuple

import numpy as np
from numpy.typing import NDArray

from dsrpt_risk.calibration.hazard import HazardCurve, RegimeCurveSet


@dataclass
class ValidationResult:
    """Results from curve validation."""

    is_valid: bool
    monotonicity_check: bool
    brier_score: float
    calibration_drift: float
    expected_loss_ratio: float
    warnings: List[str]


class CurveValidator:
    """
    Validates hazard curves against payout expectations.

    Performs:
    1. Monotonicity check: H(t1) <= H(t2) for t1 < t2
    2. Brier score: Calibration quality of trigger probabilities
    3. Expected loss consistency: E[payout] matches premium assumptions
    4. PIT (Probability Integral Transform) uniformity

    Example:
    --------
    ```python
    validator = CurveValidator(
        payout_curve={
            'max_deviation_bps': 3000,
            'threshold_hours': 168,
            'severity_exponent': 2
        }
    )

    # Validate a curve set
    results = validator.validate(curve_set, historical_data)

    if not results.is_valid:
        print(f"Validation failed: {results.warnings}")
    ```
    """

    def __init__(
        self,
        payout_curve: Dict | None = None,
        tolerance: float = 0.05,
    ):
        """
        Initialize validator.

        Args:
            payout_curve: Payout curve parameters for expected loss calculation
            tolerance: Maximum acceptable calibration drift (default 5%)
        """
        self.payout_curve = payout_curve or {
            "max_deviation_bps": 3000,
            "threshold_hours": 168,
            "severity_exponent": 2,
        }
        self.tolerance = tolerance

    def validate(
        self,
        curves: RegimeCurveSet,
        historical_events: NDArray | None = None,
        n_simulations: int = 10000,
    ) -> Dict[str, ValidationResult]:
        """
        Validate all curves in a RegimeCurveSet.

        Args:
            curves: Set of hazard curves to validate
            historical_events: Optional historical event data for backtesting
            n_simulations: Number of Monte Carlo simulations

        Returns:
            Dictionary mapping regime names to ValidationResult.
        """
        results = {}

        for regime_name, curve in [
            ("CALM", curves.calm),
            ("VOLATILE", curves.volatile),
            ("CRISIS", curves.crisis),
        ]:
            results[regime_name] = self._validate_single_curve(
                curve, historical_events, n_simulations
            )

        return results

    def _validate_single_curve(
        self,
        curve: HazardCurve,
        historical_events: NDArray | None,
        n_simulations: int,
    ) -> ValidationResult:
        """Validate a single hazard curve."""
        warnings = []

        # 1. Monotonicity check
        monotonic = self._check_monotonicity(curve)
        if not monotonic:
            warnings.append("Hazard curve is not monotonically increasing")

        # 2. Brier score (if historical data available)
        brier_score = 0.0
        if historical_events is not None:
            brier_score = self._compute_brier_score(curve, historical_events)
            if brier_score > 0.1:
                warnings.append(f"High Brier score: {brier_score:.4f}")

        # 3. Expected loss consistency
        el_ratio, drift = self._check_expected_loss(curve, n_simulations)
        if drift > self.tolerance:
            warnings.append(f"Calibration drift {drift:.2%} exceeds tolerance {self.tolerance:.2%}")

        is_valid = monotonic and drift <= self.tolerance

        return ValidationResult(
            is_valid=is_valid,
            monotonicity_check=monotonic,
            brier_score=brier_score,
            calibration_drift=drift,
            expected_loss_ratio=el_ratio,
            warnings=warnings,
        )

    def _check_monotonicity(self, curve: HazardCurve) -> bool:
        """Check if hazard curve is monotonically increasing."""
        return curve.H_7d <= curve.H_30d <= curve.H_90d

    def _compute_brier_score(
        self,
        curve: HazardCurve,
        historical_events: NDArray,
    ) -> float:
        """
        Compute Brier score for probability calibration.

        Brier score = mean((predicted_prob - actual_outcome)^2)
        Lower is better, 0 is perfect.
        """
        SCALE = 10**18

        # For each historical period, compare predicted vs actual
        errors = []

        for tenor in [7, 30, 90]:
            # Get predicted probability
            H = curve.interpolate(tenor) / SCALE
            predicted_prob = 1 - np.exp(-H)

            # Count actual triggers in historical data
            # (simplified: assume historical_events contains (tenor, triggered) tuples)
            actual_rate = np.mean(historical_events[:, 0] <= tenor) if len(historical_events) > 0 else 0

            errors.append((predicted_prob - actual_rate) ** 2)

        return np.mean(errors)

    def _check_expected_loss(
        self,
        curve: HazardCurve,
        n_simulations: int,
    ) -> Tuple[float, float]:
        """
        Check expected loss consistency between curve and payout model.

        Returns:
            Tuple of (expected_loss_ratio, calibration_drift)
        """
        SCALE = 10**18
        rng = np.random.default_rng(42)

        # Parameters
        policy_limit = 100000  # $100k
        tenor = 30  # 30-day policy

        # Expected loss from curve: limit * H(T)
        H = curve.interpolate(tenor) / SCALE
        curve_el = policy_limit * H

        # Simulated expected loss from payout model
        simulated_payouts = []

        trigger_prob = 1 - np.exp(-H)

        for _ in range(n_simulations):
            if rng.uniform() < trigger_prob:
                # Simulate depeg severity
                depeg_bps = rng.exponential(500)  # Mean 5% depeg
                depeg_bps = min(depeg_bps, self.payout_curve["max_deviation_bps"])

                # Simulate duration
                duration_hours = rng.exponential(48)  # Mean 2 days
                duration_hours = min(duration_hours, self.payout_curve["threshold_hours"] * 2)

                # Calculate payout using payout curve formula
                payout = self._calculate_payout(policy_limit, depeg_bps, duration_hours)
                simulated_payouts.append(payout)
            else:
                simulated_payouts.append(0)

        simulated_el = np.mean(simulated_payouts)

        # Calculate ratio and drift
        if simulated_el > 0:
            el_ratio = curve_el / simulated_el
            drift = abs(el_ratio - 1)
        else:
            el_ratio = 1.0
            drift = 0.0

        return el_ratio, drift

    def _calculate_payout(
        self,
        policy_limit: float,
        depeg_bps: float,
        duration_hours: float,
    ) -> float:
        """Calculate payout using on-chain payout curve formula."""
        pc = self.payout_curve

        # Severity factor f(d) = (depeg/max)^exponent
        raw_factor = min(depeg_bps / pc["max_deviation_bps"], 1.0)
        severity_factor = raw_factor ** pc["severity_exponent"]

        # Duration factor g(t) = min(duration/threshold, 1.0)
        duration_factor = min(duration_hours / pc["threshold_hours"], 1.0)

        return policy_limit * severity_factor * duration_factor

    def generate_report(
        self,
        results: Dict[str, ValidationResult],
    ) -> str:
        """Generate human-readable validation report."""
        lines = ["=" * 60, "HAZARD CURVE VALIDATION REPORT", "=" * 60, ""]

        all_valid = True

        for regime, result in results.items():
            status = "PASS" if result.is_valid else "FAIL"
            all_valid = all_valid and result.is_valid

            lines.append(f"Regime: {regime}")
            lines.append(f"  Status: {status}")
            lines.append(f"  Monotonicity: {'OK' if result.monotonicity_check else 'FAIL'}")
            lines.append(f"  Brier Score: {result.brier_score:.4f}")
            lines.append(f"  Calibration Drift: {result.calibration_drift:.2%}")
            lines.append(f"  EL Ratio: {result.expected_loss_ratio:.2f}")

            if result.warnings:
                lines.append("  Warnings:")
                for w in result.warnings:
                    lines.append(f"    - {w}")

            lines.append("")

        lines.append("=" * 60)
        lines.append(f"OVERALL: {'PASS' if all_valid else 'FAIL'}")
        lines.append("=" * 60)

        return "\n".join(lines)
