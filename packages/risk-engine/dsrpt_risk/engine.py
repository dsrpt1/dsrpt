"""
Main Risk Engine orchestrating all components.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
from numpy.typing import NDArray

from dsrpt_risk.config import Config, load_config
from dsrpt_risk.models import EVTModel, HawkesProcess, RegimeClassifier, RegimeKind
from dsrpt_risk.calibration import HazardCalibrator, RegimeCurveSet, CurveValidator
from dsrpt_risk.hedging import MetaHedger, HedgePosition


class RiskEngine:
    """
    Main orchestrator for DSRPT Risk Engine.

    Coordinates:
    - Regime classification
    - Hazard curve calibration
    - Validation
    - Meta-hedging
    - On-chain transaction generation

    Example:
    --------
    ```python
    engine = RiskEngine.from_config("config.yaml")

    # Load historical data
    engine.load_data(prices, events)

    # Run full calibration pipeline
    curves = engine.calibrate()

    # Generate on-chain update transaction
    tx_data = engine.generate_curve_update_tx(curves)
    ```
    """

    def __init__(self, config: Config):
        """Initialize with configuration."""
        self.config = config

        # Initialize models
        self.regime_classifier = RegimeClassifier(n_regimes=config.regime.n_regimes)
        self.evt_model = EVTModel()
        self.hawkes_model = HawkesProcess()
        self.calibrator = HazardCalibrator(
            trigger_threshold=config.hazard.trigger_threshold,
            trigger_duration_hours=config.hazard.trigger_duration_hours,
        )
        self.validator = CurveValidator(tolerance=0.05)
        self.hedger = MetaHedger(
            vol_threshold_low_bps=config.hedging.vol_threshold_low_bps,
            vol_threshold_high_bps=config.hedging.vol_threshold_high_bps,
            liquidity_threshold_bps=config.hedging.liquidity_threshold_bps,
            book_exposure_pct=config.hedging.book_exposure_pct,
        )

        # Data storage
        self._prices: NDArray | None = None
        self._events: NDArray | None = None
        self._features: NDArray | None = None
        self._regimes: NDArray | None = None

        # Calibration results
        self._curves: RegimeCurveSet | None = None
        self._current_regime: RegimeKind | None = None

    @classmethod
    def from_config(cls, config_path: str | Path | None = None) -> "RiskEngine":
        """Create engine from config file."""
        config = load_config(config_path)
        return cls(config)

    def load_data(
        self,
        prices: NDArray,
        events: NDArray | None = None,
        features: NDArray | None = None,
    ) -> "RiskEngine":
        """
        Load historical data for calibration.

        Args:
            prices: Price time series (daily USDC prices, e.g., 0.9998, 1.0001, ...)
            events: Optional array of (time, magnitude) for depeg events
            features: Optional feature matrix for regime classification

        Returns:
            Self for method chaining.
        """
        self._prices = np.asarray(prices)

        if events is not None:
            self._events = np.asarray(events)

        if features is not None:
            self._features = np.asarray(features)
        else:
            # Extract features from prices
            self._features = self._extract_features(self._prices)

        return self

    def classify_regime(self, features: NDArray | None = None) -> RegimeKind:
        """
        Classify current market regime.

        Args:
            features: Optional feature vector. If None, uses latest from loaded data.

        Returns:
            Current RegimeKind.
        """
        if features is None:
            if self._features is None:
                raise ValueError("No features available. Call load_data() first.")
            features = self._features[-1]

        # Fit classifier if not already fitted
        if not self.regime_classifier._fitted:
            self.regime_classifier.fit(self._features)

        state = self.regime_classifier.classify(features)
        self._current_regime = state.regime

        return state.regime

    def calibrate(
        self,
        n_simulations: int | None = None,
    ) -> RegimeCurveSet:
        """
        Run full calibration pipeline.

        Steps:
        1. Classify regimes for historical data
        2. Fit EVT + Hawkes models per regime
        3. Monte Carlo simulation for hazard curves
        4. Validate calibrated curves

        Args:
            n_simulations: Override config simulation count.

        Returns:
            Calibrated RegimeCurveSet.
        """
        if self._prices is None:
            raise ValueError("No data loaded. Call load_data() first.")

        n_sims = n_simulations or self.config.hazard.simulation_count

        # Step 1: Classify regimes
        if not self.regime_classifier._fitted:
            self.regime_classifier.fit(self._features)

        self._regimes, _ = self.regime_classifier.classify_sequence(self._features)

        # Step 2: Extract events if not provided
        if self._events is None:
            self._events = self._extract_events(self._prices)

        # Get event magnitudes and times
        event_times = self._events[:, 0]
        event_magnitudes = self._events[:, 1]

        # Step 3: Fit calibrator
        self.calibrator.fit(
            depeg_magnitudes=event_magnitudes,
            event_times=event_times,
            regimes=self._regimes[event_times.astype(int)],
            observation_period_days=len(self._prices),
        )

        # Step 4: Calibrate curves
        self._curves = self.calibrator.calibrate(
            tenors=self.config.hazard.tenors_days,
            n_simulations=n_sims,
            peril_id=self.config.peril_id,
        )

        # Step 5: Validate
        validation_results = self.validator.validate(self._curves)

        # Log validation
        for regime, result in validation_results.items():
            if not result.is_valid:
                print(f"Warning: {regime} curve validation failed: {result.warnings}")

        return self._curves

    def generate_curve_update_tx(
        self,
        curves: RegimeCurveSet | None = None,
    ) -> Dict:
        """
        Generate transaction data for on-chain curve update.

        Args:
            curves: Curves to encode. If None, uses last calibration.

        Returns:
            Dictionary with transaction data for setCurveConfig.
        """
        if curves is None:
            curves = self._curves
        if curves is None:
            raise ValueError("No curves available. Call calibrate() first.")

        config = curves.to_curve_config()

        return {
            "to": self.config.chain.hazard_engine_address,
            "function": "setCurveConfig",
            "args": [config],
            "peril_id": curves.peril_id,
            "calibration_time": datetime.now().isoformat(),
        }

    def compute_hedge_positions(
        self,
        oracle_state: Dict,
        portfolio_state: Dict,
    ) -> List[HedgePosition]:
        """
        Compute recommended hedge positions.

        Args:
            oracle_state: Dict with peg_dev_bps, vol_bps, disagreement_bps, shock_flag
            portfolio_state: Dict with book_notional, expected_premium, etc.

        Returns:
            List of recommended HedgePosition objects.
        """
        from dsrpt_risk.hedging.positions import OracleSnapshot, PortfolioSnapshot

        oracle = OracleSnapshot(
            peg_dev_bps=oracle_state.get("peg_dev_bps", 0),
            vol_bps=oracle_state.get("vol_bps", 0),
            disagreement_bps=oracle_state.get("disagreement_bps", 0),
            shock_flag=oracle_state.get("shock_flag", 0),
        )

        portfolio = PortfolioSnapshot(
            book_notional=portfolio_state.get("book_notional", 0),
            expected_premium=portfolio_state.get("expected_premium", 0),
            utilization_bps=portfolio_state.get("utilization_bps", 0),
            capital_ratio_bps=portfolio_state.get("capital_ratio_bps", 10000),
        )

        return self.hedger.compute_hedge_positions(oracle, portfolio)

    def _extract_features(self, prices: NDArray) -> NDArray:
        """Extract features from price series for regime classification."""
        n = len(prices)
        window = min(30, n // 3)

        features = []

        for i in range(window, n):
            window_prices = prices[i - window : i]

            # Feature 1: Volatility (std of log returns)
            returns = np.diff(np.log(window_prices))
            vol = np.std(returns) * np.sqrt(252) * 10000  # Annualized, in bps

            # Feature 2: Max drawdown
            cummax = np.maximum.accumulate(window_prices)
            drawdown = (cummax - window_prices) / cummax
            max_dd = np.max(drawdown) * 10000  # In bps

            # Feature 3: Peg deviation
            peg_dev = np.abs(1 - window_prices[-1]) * 10000  # In bps

            # Feature 4: Price range (proxy for liquidity)
            price_range = (np.max(window_prices) - np.min(window_prices)) * 10000

            features.append([vol, max_dd, peg_dev, price_range])

        return np.array(features)

    def _extract_events(self, prices: NDArray, threshold_bps: int = 100) -> NDArray:
        """Extract depeg events from price series."""
        events = []

        # Deviation from peg in bps
        deviations = np.abs(1 - prices) * 10000

        # Find events above threshold
        above_threshold = deviations > threshold_bps

        # Group consecutive days into events
        in_event = False
        event_start = 0
        event_max = 0

        for i, is_depeg in enumerate(above_threshold):
            if is_depeg and not in_event:
                # Start new event
                in_event = True
                event_start = i
                event_max = deviations[i]
            elif is_depeg and in_event:
                # Continue event
                event_max = max(event_max, deviations[i])
            elif not is_depeg and in_event:
                # End event
                in_event = False
                events.append([event_start, event_max])

        # Handle event at end of series
        if in_event:
            events.append([event_start, event_max])

        return np.array(events) if events else np.array([[0, 0]])
