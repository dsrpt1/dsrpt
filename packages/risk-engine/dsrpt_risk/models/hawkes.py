"""
Hawkes Process model for event clustering in depeg events.

The Hawkes process models self-exciting point processes where the occurrence
of an event increases the probability of subsequent events (clustering).

Theory:
-------
The intensity function λ(t) is:

    λ(t) = λ₀ + Σᵢ α × exp(-β × (t - tᵢ))

where:
- λ₀: Baseline intensity (background rate)
- α: Jump size when event occurs (excitation)
- β: Decay rate (how quickly excitation fades)
- tᵢ: Times of past events

The branching ratio α/β determines clustering strength:
- α/β < 1: Subcritical (stable process)
- α/β = 1: Critical (marginally stable)
- α/β > 1: Supercritical (explosive, unrealistic)

For depeg events, we expect moderate clustering (α/β ≈ 0.3-0.7)
where one depeg event increases likelihood of subsequent depegs.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Tuple

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import minimize


@dataclass
class HawkesParams:
    """Hawkes process parameters."""

    lambda0: float  # Baseline intensity (events per day)
    alpha: float  # Jump size (excitation parameter)
    beta: float  # Decay rate (per day)

    @property
    def branching_ratio(self) -> float:
        """Branching ratio α/β (should be < 1 for stability)."""
        return self.alpha / self.beta if self.beta > 0 else float("inf")

    @property
    def mean_intensity(self) -> float:
        """Unconditional mean intensity λ₀ / (1 - α/β)."""
        br = self.branching_ratio
        if br >= 1:
            return float("inf")
        return self.lambda0 / (1 - br)

    @property
    def is_stable(self) -> bool:
        """Check if process is subcritical (stable)."""
        return self.branching_ratio < 1


class HawkesProcess:
    """
    Univariate Hawkes process with exponential kernel.

    Models clustering of depeg events where each event
    increases the probability of subsequent events.

    Example:
    --------
    ```python
    # Fit model to event times
    hawkes = HawkesProcess()
    hawkes.fit(event_times, T_max=365)

    # Calculate current intensity
    intensity = hawkes.intensity(current_time, event_times)

    # Simulate future events
    future_events = hawkes.simulate(n_days=30)
    ```
    """

    def __init__(self):
        self.params: HawkesParams | None = None
        self._event_times: NDArray | None = None
        self._T_max: float = 0

    def fit(
        self,
        event_times: NDArray,
        T_max: float | None = None,
        method: str = "mle",
    ) -> HawkesParams:
        """
        Fit Hawkes process to observed event times.

        Args:
            event_times: Array of event times (sorted, in days from start)
            T_max: Observation window end time (if None, uses max event time)
            method: Fitting method ('mle' or 'em')

        Returns:
            HawkesParams with fitted parameters.

        Raises:
            ValueError: If insufficient events for fitting.
        """
        event_times = np.sort(np.asarray(event_times))
        self._event_times = event_times

        if len(event_times) < 3:
            raise ValueError(f"Insufficient events ({len(event_times)}) for Hawkes fitting")

        if T_max is None:
            T_max = event_times[-1] * 1.1  # Add 10% buffer
        self._T_max = T_max

        if method == "mle":
            params = self._fit_mle(event_times, T_max)
        elif method == "em":
            params = self._fit_em(event_times, T_max)
        else:
            raise ValueError(f"Unknown method: {method}")

        self.params = params
        return params

    def intensity(self, t: float, event_times: NDArray | None = None) -> float:
        """
        Calculate intensity (conditional rate) at time t.

        λ(t) = λ₀ + Σᵢ α × exp(-β × (t - tᵢ)) for tᵢ < t

        Args:
            t: Time to evaluate intensity
            event_times: Past event times (if None, uses fitted data)

        Returns:
            Intensity at time t.
        """
        if self.params is None:
            raise ValueError("Model not fitted. Call fit() first.")

        if event_times is None:
            event_times = self._event_times

        params = self.params

        # Baseline intensity
        intensity = params.lambda0

        # Add excitation from past events
        past_events = event_times[event_times < t]
        for ti in past_events:
            intensity += params.alpha * np.exp(-params.beta * (t - ti))

        return intensity

    def integrated_intensity(
        self,
        t_start: float,
        t_end: float,
        event_times: NDArray | None = None,
    ) -> float:
        """
        Calculate integrated intensity (compensator) over interval.

        Λ(t_start, t_end) = ∫_{t_start}^{t_end} λ(s) ds

        Args:
            t_start: Start of interval
            t_end: End of interval
            event_times: Past event times

        Returns:
            Integrated intensity.
        """
        if self.params is None:
            raise ValueError("Model not fitted. Call fit() first.")

        if event_times is None:
            event_times = self._event_times

        params = self.params

        # Baseline contribution
        compensator = params.lambda0 * (t_end - t_start)

        # Excitation contribution
        past_events = event_times[event_times < t_end]
        for ti in past_events:
            if ti >= t_start:
                # Event in interval: integrate from ti to t_end
                compensator += (params.alpha / params.beta) * (
                    1 - np.exp(-params.beta * (t_end - ti))
                )
            else:
                # Event before interval: integrate from t_start to t_end
                compensator += (params.alpha / params.beta) * (
                    np.exp(-params.beta * (t_start - ti))
                    - np.exp(-params.beta * (t_end - ti))
                )

        return compensator

    def simulate(
        self,
        T: float,
        seed: int | None = None,
        event_history: NDArray | None = None,
    ) -> NDArray:
        """
        Simulate Hawkes process using Ogata's thinning algorithm.

        Args:
            T: Simulation horizon (days)
            seed: Random seed for reproducibility
            event_history: Past events to condition on

        Returns:
            Array of simulated event times.
        """
        if self.params is None:
            raise ValueError("Model not fitted. Call fit() first.")

        rng = np.random.default_rng(seed)
        params = self.params

        events: List[float] = []
        if event_history is not None:
            events = list(event_history[event_history < 0])  # Past events (negative times)

        t = 0.0

        # Upper bound on intensity
        lambda_bar = params.lambda0 / (1 - params.branching_ratio) if params.is_stable else 100

        while t < T:
            # Propose next event time
            dt = rng.exponential(1 / lambda_bar)
            t += dt

            if t >= T:
                break

            # Calculate actual intensity
            lambda_t = self.intensity(t, np.array(events))

            # Accept/reject
            if rng.uniform() < lambda_t / lambda_bar:
                events.append(t)
                # Update upper bound
                lambda_bar = max(lambda_bar, lambda_t + params.alpha)

        return np.array([e for e in events if e >= 0])

    def probability_no_events(self, T: float, event_times: NDArray | None = None) -> float:
        """
        Calculate probability of no events in interval [0, T].

        P(N(T) = 0) = exp(-Λ(0, T))

        Args:
            T: Horizon in days
            event_times: Conditioning events

        Returns:
            Probability of no events.
        """
        compensator = self.integrated_intensity(0, T, event_times)
        return np.exp(-compensator)

    def expected_events(self, T: float, event_times: NDArray | None = None) -> float:
        """
        Calculate expected number of events in interval [0, T].

        E[N(T)] = Λ(0, T)

        Args:
            T: Horizon in days
            event_times: Conditioning events

        Returns:
            Expected event count.
        """
        return self.integrated_intensity(0, T, event_times)

    def residual_analysis(self) -> dict:
        """
        Perform residual analysis for model validation.

        Under correct specification, transformed inter-arrival times
        should be i.i.d. Exponential(1).

        Returns:
            Dictionary with diagnostic metrics.
        """
        if self.params is None or self._event_times is None:
            raise ValueError("Model not fitted. Call fit() first.")

        event_times = self._event_times
        n = len(event_times)

        if n < 2:
            return {"ks_pvalue": 1.0, "ljung_box_pvalue": 1.0}

        # Calculate residuals (transformed inter-arrival times)
        residuals = np.zeros(n)
        residuals[0] = self.integrated_intensity(0, event_times[0], np.array([]))

        for i in range(1, n):
            residuals[i] = self.integrated_intensity(
                event_times[i - 1], event_times[i], event_times[:i]
            )

        # KS test against Exp(1)
        from scipy import stats

        ks_stat, ks_pvalue = stats.kstest(residuals, "expon", args=(0, 1))

        # Ljung-Box test for autocorrelation
        try:
            from statsmodels.stats.diagnostic import acorr_ljungbox

            lb_result = acorr_ljungbox(residuals, lags=[10], return_df=True)
            lb_pvalue = lb_result["lb_pvalue"].iloc[0]
        except ImportError:
            lb_pvalue = None

        return {
            "ks_statistic": ks_stat,
            "ks_pvalue": ks_pvalue,
            "ljung_box_pvalue": lb_pvalue,
            "mean_residual": np.mean(residuals),
            "var_residual": np.var(residuals),
        }

    def _fit_mle(self, event_times: NDArray, T_max: float) -> HawkesParams:
        """Fit using Maximum Likelihood Estimation."""
        n = len(event_times)

        def neg_log_likelihood(params):
            lambda0, alpha, beta = params

            if lambda0 <= 0 or alpha <= 0 or beta <= 0:
                return 1e10
            if alpha >= beta:  # Stability condition
                return 1e10

            # Log-likelihood: sum of log-intensities minus compensator
            ll = 0.0

            # Sum of log-intensities at event times
            A = np.zeros(n)  # A[i] = Σ_{j<i} exp(-β(t_i - t_j))
            for i in range(n):
                if i > 0:
                    A[i] = np.exp(-beta * (event_times[i] - event_times[i - 1])) * (1 + A[i - 1])
                ll += np.log(lambda0 + alpha * A[i])

            # Compensator (integrated intensity)
            compensator = lambda0 * T_max
            for ti in event_times:
                compensator += (alpha / beta) * (1 - np.exp(-beta * (T_max - ti)))

            ll -= compensator

            return -ll

        # Initial guess
        mean_rate = n / T_max
        x0 = [mean_rate * 0.5, mean_rate * 0.3, 1.0]

        result = minimize(
            neg_log_likelihood,
            x0=x0,
            method="L-BFGS-B",
            bounds=[(1e-6, None), (1e-6, None), (1e-6, None)],
        )

        return HawkesParams(
            lambda0=result.x[0],
            alpha=result.x[1],
            beta=result.x[2],
        )

    def _fit_em(self, event_times: NDArray, T_max: float, max_iter: int = 100) -> HawkesParams:
        """Fit using Expectation-Maximization algorithm."""
        n = len(event_times)

        # Initialize
        mean_rate = n / T_max
        lambda0 = mean_rate * 0.5
        alpha = mean_rate * 0.3
        beta = 1.0

        for _ in range(max_iter):
            # E-step: compute responsibilities
            P = np.zeros((n, n))  # P[i,j] = prob event i triggered by event j

            for i in range(n):
                denom = lambda0
                for j in range(i):
                    kernel = alpha * np.exp(-beta * (event_times[i] - event_times[j]))
                    P[i, j] = kernel
                    denom += kernel

                if denom > 0:
                    P[i, :i] /= denom

            # M-step: update parameters
            sum_P = np.sum(P)
            lambda0_new = (n - sum_P) / T_max

            if sum_P > 0:
                # Weighted sum for alpha and beta
                weighted_sum = 0.0
                for i in range(n):
                    for j in range(i):
                        weighted_sum += P[i, j] * (event_times[i] - event_times[j])

                beta_new = sum_P / weighted_sum if weighted_sum > 0 else beta

                # Update alpha from branching ratio
                alpha_new = sum_P / n * beta_new
            else:
                alpha_new = alpha
                beta_new = beta

            # Check convergence
            if (
                abs(lambda0_new - lambda0) < 1e-6
                and abs(alpha_new - alpha) < 1e-6
                and abs(beta_new - beta) < 1e-6
            ):
                break

            lambda0, alpha, beta = lambda0_new, alpha_new, beta_new

        return HawkesParams(lambda0=lambda0, alpha=alpha, beta=beta)
