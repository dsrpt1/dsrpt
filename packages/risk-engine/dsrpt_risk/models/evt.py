"""
Extreme Value Theory (EVT) models for tail risk estimation.

This module implements:
- Generalized Pareto Distribution (GPD) for excesses over threshold
- Generalized Extreme Value (GEV) for block maxima
- Tail probability and Value-at-Risk estimation

Theory:
-------
For high enough threshold u, the distribution of excesses X - u | X > u
converges to a Generalized Pareto Distribution:

    GPD(x; ξ, β) = 1 - (1 + ξx/β)^(-1/ξ)

where:
- ξ (xi/shape): Tail index. ξ > 0 = heavy tail, ξ = 0 = exponential, ξ < 0 = bounded
- β (beta/scale): Scale parameter

For depeg events, we expect ξ > 0 (heavy tails) since extreme depegs
can be much larger than typical deviations.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple

import numpy as np
from numpy.typing import NDArray
from scipy import stats
from scipy.optimize import minimize


@dataclass
class GPDParams:
    """Generalized Pareto Distribution parameters."""

    xi: float  # Shape parameter (tail index)
    beta: float  # Scale parameter
    threshold: float  # Threshold used for POT
    n_excesses: int  # Number of excesses used for fitting
    n_total: int  # Total sample size

    @property
    def tail_index(self) -> float:
        """Return tail index (positive = heavy tail)."""
        return self.xi

    @property
    def is_heavy_tailed(self) -> bool:
        """Check if distribution has heavy tail."""
        return self.xi > 0


@dataclass
class GEVParams:
    """Generalized Extreme Value distribution parameters."""

    xi: float  # Shape parameter
    mu: float  # Location parameter
    sigma: float  # Scale parameter
    block_size: int  # Block size in days


class EVTModel:
    """
    Extreme Value Theory model for tail risk estimation.

    Implements Peaks-Over-Threshold (POT) method with GPD fitting.

    Example:
    --------
    ```python
    # Fit model to depeg data
    model = EVTModel()
    model.fit(depeg_magnitudes, threshold_quantile=0.95)

    # Estimate tail probabilities
    prob = model.tail_probability(deviation_bps=300)

    # Calculate VaR
    var_95 = model.value_at_risk(alpha=0.95)
    ```
    """

    def __init__(self):
        self.gpd_params: GPDParams | None = None
        self.gev_params: GEVParams | None = None
        self._data: NDArray | None = None
        self._excesses: NDArray | None = None

    def fit(
        self,
        data: NDArray,
        threshold_quantile: float = 0.95,
        method: str = "mle",
    ) -> GPDParams:
        """
        Fit GPD to excesses over threshold using POT method.

        Args:
            data: Array of observations (e.g., depeg magnitudes in bps)
            threshold_quantile: Quantile for threshold selection (0.9-0.99)
            method: Fitting method ('mle' or 'pwm')

        Returns:
            GPDParams with fitted parameters.

        Raises:
            ValueError: If insufficient excesses for fitting.
        """
        self._data = np.asarray(data)
        threshold = np.quantile(self._data, threshold_quantile)

        # Get excesses
        excesses = self._data[self._data > threshold] - threshold
        self._excesses = excesses

        if len(excesses) < 10:
            raise ValueError(f"Insufficient excesses ({len(excesses)}) for GPD fitting")

        # Fit GPD
        if method == "mle":
            xi, beta = self._fit_gpd_mle(excesses)
        elif method == "pwm":
            xi, beta = self._fit_gpd_pwm(excesses)
        else:
            raise ValueError(f"Unknown method: {method}")

        self.gpd_params = GPDParams(
            xi=xi,
            beta=beta,
            threshold=threshold,
            n_excesses=len(excesses),
            n_total=len(self._data),
        )

        return self.gpd_params

    def fit_block_maxima(
        self,
        data: NDArray,
        block_size: int = 7,
    ) -> GEVParams:
        """
        Fit GEV distribution to block maxima.

        Args:
            data: Array of observations
            block_size: Block size in observations (e.g., days)

        Returns:
            GEVParams with fitted parameters.
        """
        data = np.asarray(data)
        n_blocks = len(data) // block_size

        # Compute block maxima
        maxima = np.array([
            np.max(data[i * block_size : (i + 1) * block_size])
            for i in range(n_blocks)
        ])

        # Fit GEV using scipy
        xi, mu, sigma = stats.genextreme.fit(maxima)

        self.gev_params = GEVParams(
            xi=-xi,  # scipy uses opposite sign convention
            mu=mu,
            sigma=sigma,
            block_size=block_size,
        )

        return self.gev_params

    def tail_probability(self, x: float) -> float:
        """
        Calculate probability of exceeding value x.

        P(X > x) for x > threshold

        Args:
            x: Value to calculate exceedance probability for.

        Returns:
            Probability P(X > x).
        """
        if self.gpd_params is None:
            raise ValueError("Model not fitted. Call fit() first.")

        params = self.gpd_params

        if x <= params.threshold:
            # Below threshold, use empirical
            return np.mean(self._data > x)

        # Above threshold, use GPD
        excess = x - params.threshold
        prob_exceed_threshold = params.n_excesses / params.n_total

        if params.xi == 0:
            # Exponential case
            gpd_survival = np.exp(-excess / params.beta)
        else:
            # General GPD
            term = 1 + params.xi * excess / params.beta
            if term <= 0:
                return 0.0
            gpd_survival = term ** (-1 / params.xi)

        return prob_exceed_threshold * gpd_survival

    def value_at_risk(self, alpha: float = 0.95) -> float:
        """
        Calculate Value-at-Risk at given confidence level.

        VaR_α = inf{x : P(X > x) ≤ 1 - α}

        Args:
            alpha: Confidence level (e.g., 0.95 for 95% VaR)

        Returns:
            VaR value.
        """
        if self.gpd_params is None:
            raise ValueError("Model not fitted. Call fit() first.")

        params = self.gpd_params
        p = 1 - alpha  # Exceedance probability
        prob_exceed_threshold = params.n_excesses / params.n_total

        if p >= prob_exceed_threshold:
            # Below threshold, use empirical quantile
            return np.quantile(self._data, alpha)

        # Above threshold, invert GPD survival function
        y = p / prob_exceed_threshold

        if params.xi == 0:
            # Exponential case
            excess = -params.beta * np.log(y)
        else:
            # General GPD
            excess = (params.beta / params.xi) * (y ** (-params.xi) - 1)

        return params.threshold + excess

    def expected_shortfall(self, alpha: float = 0.95) -> float:
        """
        Calculate Expected Shortfall (CVaR) at given confidence level.

        ES_α = E[X | X > VaR_α]

        Args:
            alpha: Confidence level

        Returns:
            Expected Shortfall value.
        """
        if self.gpd_params is None:
            raise ValueError("Model not fitted. Call fit() first.")

        params = self.gpd_params
        var = self.value_at_risk(alpha)

        if params.xi >= 1:
            # Infinite mean case
            return float("inf")

        # ES = VaR / (1 - xi) + (beta - xi * threshold) / (1 - xi)
        es = var / (1 - params.xi) + (params.beta - params.xi * params.threshold) / (1 - params.xi)

        return es

    def simulate(self, n_samples: int, seed: int | None = None) -> NDArray:
        """
        Simulate samples from fitted distribution.

        Args:
            n_samples: Number of samples to generate
            seed: Random seed for reproducibility

        Returns:
            Array of simulated values.
        """
        if self.gpd_params is None:
            raise ValueError("Model not fitted. Call fit() first.")

        rng = np.random.default_rng(seed)
        params = self.gpd_params

        # Simulate from GPD
        u = rng.uniform(0, 1, n_samples)

        if params.xi == 0:
            excesses = -params.beta * np.log(u)
        else:
            excesses = (params.beta / params.xi) * (u ** (-params.xi) - 1)

        return params.threshold + excesses

    def diagnostic_plots(self) -> dict:
        """
        Generate diagnostic statistics for model validation.

        Returns:
            Dictionary with diagnostic metrics:
            - qq_correlation: Q-Q plot correlation
            - mean_excess_slope: Slope of mean excess plot
            - tail_index_se: Standard error of tail index estimate
        """
        if self.gpd_params is None or self._excesses is None:
            raise ValueError("Model not fitted. Call fit() first.")

        params = self.gpd_params
        excesses = self._excesses

        # Q-Q correlation
        theoretical = stats.genpareto.ppf(
            np.linspace(0.01, 0.99, len(excesses)),
            params.xi,
            scale=params.beta,
        )
        empirical = np.sort(excesses)
        qq_corr = np.corrcoef(theoretical, empirical)[0, 1]

        # Mean excess function slope (should be positive for heavy tails)
        thresholds = np.quantile(excesses, np.linspace(0, 0.9, 10))
        mean_excesses = [np.mean(excesses[excesses > t] - t) for t in thresholds]
        if len(mean_excesses) > 1:
            slope = np.polyfit(thresholds, mean_excesses, 1)[0]
        else:
            slope = 0.0

        # Standard error of xi (asymptotic)
        n = len(excesses)
        xi_se = np.sqrt((1 + params.xi) ** 2 / n)

        return {
            "qq_correlation": qq_corr,
            "mean_excess_slope": slope,
            "tail_index_se": xi_se,
            "n_excesses": n,
        }

    def _fit_gpd_mle(self, excesses: NDArray) -> Tuple[float, float]:
        """Fit GPD using Maximum Likelihood Estimation."""

        def neg_log_likelihood(params):
            xi, log_beta = params
            beta = np.exp(log_beta)

            if beta <= 0:
                return 1e10

            n = len(excesses)

            if abs(xi) < 1e-10:
                # Exponential case
                return n * log_beta + np.sum(excesses) / beta

            term = 1 + xi * excesses / beta
            if np.any(term <= 0):
                return 1e10

            return n * log_beta + (1 + 1 / xi) * np.sum(np.log(term))

        # Initial guess using method of moments
        mean_excess = np.mean(excesses)
        var_excess = np.var(excesses)
        xi_init = 0.5 * (mean_excess**2 / var_excess - 1)
        beta_init = mean_excess * (1 - xi_init)

        result = minimize(
            neg_log_likelihood,
            x0=[xi_init, np.log(max(beta_init, 0.01))],
            method="Nelder-Mead",
        )

        xi = result.x[0]
        beta = np.exp(result.x[1])

        return xi, beta

    def _fit_gpd_pwm(self, excesses: NDArray) -> Tuple[float, float]:
        """Fit GPD using Probability Weighted Moments."""
        n = len(excesses)
        excesses_sorted = np.sort(excesses)

        # First two probability weighted moments
        weights = np.arange(1, n + 1) / (n + 1)
        m0 = np.mean(excesses_sorted)
        m1 = np.mean(excesses_sorted * weights)

        # PWM estimators
        xi = 2 - m0 / (m0 - 2 * m1)
        beta = 2 * m0 * m1 / (m0 - 2 * m1)

        return xi, beta
