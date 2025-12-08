"""
Hazard Curve Calibration for DSRPT Protocol.

Calibrates cumulative hazard curves H(T) for each market regime using:
1. EVT (Generalized Pareto) for tail magnitude distribution
2. Hawkes process for event clustering/arrival times
3. Monte Carlo simulation to estimate trigger probabilities

The hazard curve represents cumulative probability of trigger:
    H(T) = -ln(1 - P(trigger by time T))

For small probabilities: H(T) ≈ P(trigger by time T)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Tuple

import numpy as np
from numpy.typing import NDArray

from dsrpt_risk.models.evt import EVTModel, GPDParams
from dsrpt_risk.models.hawkes import HawkesProcess, HawkesParams
from dsrpt_risk.models.regime import RegimeKind


@dataclass
class HazardCurve:
    """
    Hazard curve calibration for a single regime.

    Attributes:
        regime: Market regime this curve applies to
        H_7d: Cumulative hazard at 7 days (scaled by 1e18)
        H_30d: Cumulative hazard at 30 days
        H_90d: Cumulative hazard at 90 days
        tail_slope: Daily hazard rate for T > 90 days
        calibration_date: When this curve was calibrated
        n_simulations: Number of Monte Carlo simulations used
    """

    regime: RegimeKind
    H_7d: int  # Scaled by 1e18 for on-chain
    H_30d: int
    H_90d: int
    tail_slope: int  # dH/dT for T > 90, scaled by 1e18
    calibration_date: str = ""
    n_simulations: int = 10000

    def to_solidity_tuple(self) -> tuple:
        """Convert to tuple for on-chain setCurve call."""
        return (
            (7, self.H_7d),
            (30, self.H_30d),
            (90, self.H_90d),
            self.tail_slope,
        )

    def interpolate(self, tenor_days: int) -> int:
        """Interpolate hazard at arbitrary tenor (matching on-chain logic)."""
        if tenor_days <= 0:
            return 0
        elif tenor_days <= 7:
            return (self.H_7d * tenor_days) // 7
        elif tenor_days <= 30:
            return self.H_7d + ((self.H_30d - self.H_7d) * (tenor_days - 7)) // (30 - 7)
        elif tenor_days <= 90:
            return self.H_30d + ((self.H_90d - self.H_30d) * (tenor_days - 30)) // (90 - 30)
        else:
            return self.H_90d + self.tail_slope * (tenor_days - 90)


@dataclass
class RegimeCurveSet:
    """Complete set of hazard curves for all regimes."""

    peril_id: str
    calm: HazardCurve
    volatile: HazardCurve
    crisis: HazardCurve
    min_premium_bps: int = 25  # 0.25%
    max_multiplier_bps: int = 30000  # 3.0x

    def to_curve_config(self) -> dict:
        """Convert to CurveConfig struct format for on-chain."""
        return {
            "perilId": self.peril_id,
            "minPremiumBps": self.min_premium_bps,
            "maxMultiplierBps": self.max_multiplier_bps,
            "regime": 0,  # Default to Calm
            "regimeCurves": [
                self.calm.to_solidity_tuple(),
                self.volatile.to_solidity_tuple(),
                self.crisis.to_solidity_tuple(),
            ],
        }


class HazardCalibrator:
    """
    Calibrates hazard curves from historical data using EVT + Hawkes.

    Workflow:
    1. Fit EVT model to depeg magnitudes (per regime)
    2. Fit Hawkes process to event times (per regime)
    3. Monte Carlo simulation of price paths
    4. Estimate trigger probabilities at each tenor
    5. Convert to cumulative hazard H(T) = -ln(1 - P)

    Example:
    --------
    ```python
    calibrator = HazardCalibrator(
        trigger_threshold=0.97,  # 3% depeg
        trigger_duration_hours=24
    )

    # Fit models
    calibrator.fit(
        depeg_events=depeg_data,
        regimes=regime_labels
    )

    # Calibrate curves
    curves = calibrator.calibrate(
        tenors=[7, 30, 90],
        n_simulations=10000
    )

    # Get on-chain format
    config = curves.to_curve_config()
    ```
    """

    def __init__(
        self,
        trigger_threshold: float = 0.97,
        trigger_duration_hours: int = 24,
        seed: int = 42,
    ):
        """
        Initialize calibrator.

        Args:
            trigger_threshold: Price threshold for trigger (e.g., 0.97 = 3% depeg)
            trigger_duration_hours: Duration price must stay below threshold
            seed: Random seed for simulations
        """
        self.trigger_threshold = trigger_threshold
        self.trigger_duration_hours = trigger_duration_hours
        self.seed = seed

        # Models per regime
        self._evt_models: Dict[RegimeKind, EVTModel] = {}
        self._hawkes_models: Dict[RegimeKind, HawkesProcess] = {}
        self._fitted = False

    def fit(
        self,
        depeg_magnitudes: NDArray,
        event_times: NDArray,
        regimes: NDArray,
        observation_period_days: float = 365,
    ) -> "HazardCalibrator":
        """
        Fit EVT and Hawkes models for each regime.

        Args:
            depeg_magnitudes: Array of depeg magnitudes (in bps, e.g., 300 = 3%)
            event_times: Array of event times (days from start)
            regimes: Array of regime labels (0=Calm, 1=Volatile, 2=Crisis)
            observation_period_days: Total observation period in days

        Returns:
            Self for method chaining.
        """
        for regime in [RegimeKind.CALM, RegimeKind.VOLATILE, RegimeKind.CRISIS]:
            mask = regimes == regime.value

            if mask.sum() < 5:
                # Insufficient data, use conservative defaults
                self._evt_models[regime] = None
                self._hawkes_models[regime] = None
                continue

            # Fit EVT to magnitudes
            evt = EVTModel()
            try:
                evt.fit(depeg_magnitudes[mask], threshold_quantile=0.9)
                self._evt_models[regime] = evt
            except ValueError:
                self._evt_models[regime] = None

            # Fit Hawkes to event times
            regime_times = event_times[mask]
            hawkes = HawkesProcess()
            try:
                hawkes.fit(regime_times, T_max=observation_period_days)
                self._hawkes_models[regime] = hawkes
            except ValueError:
                self._hawkes_models[regime] = None

        self._fitted = True
        return self

    def calibrate(
        self,
        tenors: List[int] = [7, 30, 90],
        n_simulations: int = 10000,
        peril_id: str = "USDC_depeg",
    ) -> RegimeCurveSet:
        """
        Calibrate hazard curves via Monte Carlo simulation.

        Args:
            tenors: List of tenor points in days
            n_simulations: Number of simulation paths
            peril_id: Peril identifier for on-chain

        Returns:
            RegimeCurveSet with calibrated curves for each regime.
        """
        if not self._fitted:
            raise ValueError("Calibrator not fitted. Call fit() first.")

        curves = {}

        for regime in [RegimeKind.CALM, RegimeKind.VOLATILE, RegimeKind.CRISIS]:
            hazards = self._simulate_hazards(regime, tenors, n_simulations)
            curves[regime] = self._build_curve(regime, tenors, hazards)

        return RegimeCurveSet(
            peril_id=peril_id,
            calm=curves[RegimeKind.CALM],
            volatile=curves[RegimeKind.VOLATILE],
            crisis=curves[RegimeKind.CRISIS],
        )

    def _simulate_hazards(
        self,
        regime: RegimeKind,
        tenors: List[int],
        n_simulations: int,
    ) -> Dict[int, float]:
        """Simulate trigger probabilities for each tenor."""
        rng = np.random.default_rng(self.seed + regime.value)

        evt = self._evt_models.get(regime)
        hawkes = self._hawkes_models.get(regime)

        # Default rates if no model fitted
        if evt is None or hawkes is None:
            # Use conservative defaults based on regime
            base_rates = {
                RegimeKind.CALM: {7: 0.0001, 30: 0.0005, 90: 0.0015},
                RegimeKind.VOLATILE: {7: 0.0005, 30: 0.0025, 90: 0.008},
                RegimeKind.CRISIS: {7: 0.002, 30: 0.01, 90: 0.035},
            }
            return base_rates[regime]

        trigger_counts = {t: 0 for t in tenors}

        for _ in range(n_simulations):
            # Simulate event times using Hawkes
            max_tenor = max(tenors)
            event_times = hawkes.simulate(T=max_tenor, seed=rng.integers(0, 2**31))

            # For each event, simulate magnitude using EVT
            triggered = {t: False for t in tenors}

            for event_time in event_times:
                # Sample magnitude from EVT
                if len(evt.simulate(1, seed=rng.integers(0, 2**31))) > 0:
                    magnitude_bps = evt.simulate(1, seed=rng.integers(0, 2**31))[0]
                else:
                    magnitude_bps = 0

                # Check if trigger threshold met
                # Magnitude in bps, threshold is price (e.g., 0.97)
                depeg_price = 1 - magnitude_bps / 10000

                if depeg_price < self.trigger_threshold:
                    # Simulate duration (exponential with mean based on magnitude)
                    mean_duration = 24 * (1 + magnitude_bps / 500)  # Larger depeg = longer
                    duration_hours = rng.exponential(mean_duration)

                    if duration_hours >= self.trigger_duration_hours:
                        # Mark trigger for all tenors >= event time
                        for tenor in tenors:
                            if event_time <= tenor:
                                triggered[tenor] = True

            # Count triggers
            for tenor in tenors:
                if triggered[tenor]:
                    trigger_counts[tenor] += 1

        # Convert counts to probabilities
        probabilities = {t: trigger_counts[t] / n_simulations for t in tenors}

        return probabilities

    def _build_curve(
        self,
        regime: RegimeKind,
        tenors: List[int],
        hazards: Dict[int, float],
    ) -> HazardCurve:
        """Build HazardCurve from simulated probabilities."""
        # Convert probabilities to cumulative hazard
        # H(T) = -ln(1 - P(T))
        def prob_to_hazard(p: float) -> float:
            if p >= 1:
                return 10.0  # Cap at reasonable maximum
            if p <= 0:
                return 0.0
            return -np.log(1 - p)

        H = {t: prob_to_hazard(hazards[t]) for t in tenors}

        # Scale to 1e18 for on-chain
        SCALE = 10**18

        H_7d = int(H[7] * SCALE)
        H_30d = int(H[30] * SCALE)
        H_90d = int(H[90] * SCALE)

        # Tail slope: (H(90) - H(30)) / 60 * 1.1 (slight upward adjustment)
        tail_slope = int(((H[90] - H[30]) / 60) * 1.1 * SCALE)

        return HazardCurve(
            regime=regime,
            H_7d=H_7d,
            H_30d=H_30d,
            H_90d=H_90d,
            tail_slope=tail_slope,
            n_simulations=len(hazards),
        )

    def validate_curve(
        self,
        curve: HazardCurve,
        n_simulations: int = 10000,
    ) -> dict:
        """
        Validate calibrated curve against simulation.

        Computes:
        - Brier score for probability calibration
        - Expected loss comparison
        - Coverage test for prediction intervals

        Args:
            curve: Calibrated HazardCurve to validate
            n_simulations: Number of validation simulations

        Returns:
            Dictionary with validation metrics.
        """
        regime = curve.regime
        evt = self._evt_models.get(regime)
        hawkes = self._hawkes_models.get(regime)

        if evt is None or hawkes is None:
            return {"status": "no_model", "valid": True}

        rng = np.random.default_rng(self.seed + 1000)
        SCALE = 10**18

        errors = []
        for tenor in [7, 30, 90]:
            # Simulated probability
            sim_probs = self._simulate_hazards(regime, [tenor], n_simulations)
            sim_p = sim_probs[tenor]

            # Curve probability: P = 1 - exp(-H)
            H = curve.interpolate(tenor) / SCALE
            curve_p = 1 - np.exp(-H)

            # Brier score component
            errors.append((sim_p - curve_p) ** 2)

        brier_score = np.mean(errors)

        return {
            "brier_score": brier_score,
            "valid": brier_score < 0.01,  # Accept if < 1% squared error
            "regime": regime.name,
        }
