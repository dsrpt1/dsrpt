"""
Regime Classifier for market state detection.

Implements Hidden Markov Model (HMM) and clustering-based approaches
to classify market conditions into discrete regimes:
- Calm: Normal market conditions, low volatility
- Volatile: Elevated but manageable risk
- Crisis: Extreme risk conditions

Features used for classification:
- Realized volatility (rolling std of returns)
- Maximum drawdown (peak-to-trough decline)
- Cross-venue spread (disagreement between exchanges)
- Liquidity depth (order book depth to move price 1%)
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum
from typing import List, Tuple

import numpy as np
from numpy.typing import NDArray
from scipy import stats
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler


class RegimeKind(IntEnum):
    """Market regime classifications matching on-chain enum."""

    CALM = 0
    VOLATILE = 1
    CRISIS = 2


@dataclass
class RegimeState:
    """Current regime state with metadata."""

    regime: RegimeKind
    confidence: float  # Probability of being in this regime
    features: dict  # Feature values used for classification
    transition_probs: dict | None = None  # Transition probabilities


class RegimeClassifier:
    """
    Hidden Markov Model-based regime classifier.

    Classifies market conditions into Calm/Volatile/Crisis regimes
    based on observable features.

    Example:
    --------
    ```python
    classifier = RegimeClassifier(n_regimes=3)

    # Fit on historical data
    classifier.fit(feature_matrix, method='hmm')

    # Classify current state
    state = classifier.classify(current_features)

    # Get transition probabilities
    prob_crisis = classifier.transition_probability(
        from_regime=RegimeKind.VOLATILE,
        to_regime=RegimeKind.CRISIS
    )
    ```
    """

    def __init__(self, n_regimes: int = 3):
        self.n_regimes = n_regimes
        self._scaler = StandardScaler()
        self._fitted = False

        # HMM parameters
        self._initial_probs: NDArray | None = None
        self._transition_matrix: NDArray | None = None
        self._emission_means: NDArray | None = None
        self._emission_covs: NDArray | None = None

        # K-means fallback
        self._kmeans: KMeans | None = None

        # Regime ordering (by risk level)
        self._regime_order: List[int] | None = None

    def fit(
        self,
        features: NDArray,
        method: str = "kmeans",
        labels: NDArray | None = None,
    ) -> "RegimeClassifier":
        """
        Fit regime classifier to historical feature data.

        Args:
            features: Feature matrix of shape (n_samples, n_features)
            method: 'hmm' for Hidden Markov Model, 'kmeans' for clustering
            labels: Optional known regime labels for supervised fitting

        Returns:
            Self for method chaining.
        """
        features = np.asarray(features)
        n_samples, n_features = features.shape

        # Standardize features
        features_scaled = self._scaler.fit_transform(features)

        if method == "hmm":
            self._fit_hmm(features_scaled, labels)
        elif method == "kmeans":
            self._fit_kmeans(features_scaled, labels)
        else:
            raise ValueError(f"Unknown method: {method}")

        self._fitted = True
        return self

    def classify(self, features: NDArray | dict) -> RegimeState:
        """
        Classify current market state.

        Args:
            features: Feature vector or dictionary of features

        Returns:
            RegimeState with regime, confidence, and metadata.
        """
        if not self._fitted:
            raise ValueError("Classifier not fitted. Call fit() first.")

        # Convert dict to array if needed
        if isinstance(features, dict):
            feature_dict = features
            features = np.array(list(features.values())).reshape(1, -1)
        else:
            features = np.asarray(features).reshape(1, -1)
            feature_dict = {f"feature_{i}": v for i, v in enumerate(features[0])}

        # Scale features
        features_scaled = self._scaler.transform(features)

        # Get probabilities
        if self._kmeans is not None:
            # K-means: use distances to cluster centers
            distances = self._kmeans.transform(features_scaled)[0]
            # Convert distances to probabilities (inverse softmax)
            probs = np.exp(-distances)
            probs /= probs.sum()
        else:
            # HMM: use emission probabilities
            probs = self._emission_probability(features_scaled[0])

        # Map to ordered regimes
        regime_idx = self._regime_order[np.argmax(probs)]
        confidence = probs[np.argmax(probs)]

        # Get transition probabilities from current state
        transition_probs = None
        if self._transition_matrix is not None:
            transition_probs = {
                RegimeKind(self._regime_order[j]): self._transition_matrix[regime_idx, j]
                for j in range(self.n_regimes)
            }

        return RegimeState(
            regime=RegimeKind(regime_idx),
            confidence=float(confidence),
            features=feature_dict,
            transition_probs=transition_probs,
        )

    def classify_sequence(self, features: NDArray) -> Tuple[NDArray, NDArray]:
        """
        Classify a sequence of observations (Viterbi algorithm).

        Args:
            features: Feature matrix of shape (n_samples, n_features)

        Returns:
            Tuple of (regime_sequence, probability_matrix)
        """
        if not self._fitted:
            raise ValueError("Classifier not fitted. Call fit() first.")

        features = np.asarray(features)
        features_scaled = self._scaler.transform(features)
        n_samples = len(features_scaled)

        if self._kmeans is not None:
            # Simple assignment for k-means
            labels = self._kmeans.predict(features_scaled)
            probs = np.zeros((n_samples, self.n_regimes))
            for i, label in enumerate(labels):
                probs[i, label] = 1.0
            regime_sequence = np.array([self._regime_order[l] for l in labels])
        else:
            # Viterbi for HMM
            regime_sequence, probs = self._viterbi(features_scaled)

        return regime_sequence, probs

    def transition_probability(
        self,
        from_regime: RegimeKind,
        to_regime: RegimeKind,
    ) -> float:
        """
        Get transition probability between regimes.

        Args:
            from_regime: Source regime
            to_regime: Target regime

        Returns:
            Probability P(to_regime | from_regime)
        """
        if self._transition_matrix is None:
            raise ValueError("Transition matrix not fitted")

        from_idx = self._regime_order.index(from_regime.value)
        to_idx = self._regime_order.index(to_regime.value)

        return self._transition_matrix[from_idx, to_idx]

    def regime_statistics(self) -> dict:
        """
        Get statistics about fitted regimes.

        Returns:
            Dictionary with regime means, covariances, and transition rates.
        """
        if not self._fitted:
            raise ValueError("Classifier not fitted. Call fit() first.")

        stats_dict = {}

        if self._kmeans is not None:
            centers = self._scaler.inverse_transform(self._kmeans.cluster_centers_)
            for i, idx in enumerate(self._regime_order):
                regime = RegimeKind(idx)
                stats_dict[regime.name] = {
                    "center": centers[i].tolist(),
                }
        else:
            for i, idx in enumerate(self._regime_order):
                regime = RegimeKind(idx)
                stats_dict[regime.name] = {
                    "mean": self._scaler.inverse_transform(
                        self._emission_means[i].reshape(1, -1)
                    )[0].tolist(),
                    "stationary_prob": self._initial_probs[i],
                }

        if self._transition_matrix is not None:
            stats_dict["transition_matrix"] = self._transition_matrix.tolist()

        return stats_dict

    def _fit_kmeans(self, features: NDArray, labels: NDArray | None = None):
        """Fit using K-means clustering."""
        self._kmeans = KMeans(n_clusters=self.n_regimes, random_state=42, n_init=10)
        self._kmeans.fit(features)

        # Order clusters by risk (using first feature as proxy, typically volatility)
        centers = self._kmeans.cluster_centers_
        order = np.argsort(centers[:, 0])  # Ascending by first feature
        self._regime_order = order.tolist()

        # Estimate transition matrix from consecutive labels
        labels_seq = self._kmeans.predict(features)
        self._transition_matrix = self._estimate_transition_matrix(labels_seq)

        # Initial probabilities (stationary distribution)
        self._initial_probs = self._stationary_distribution(self._transition_matrix)

    def _fit_hmm(self, features: NDArray, labels: NDArray | None = None):
        """Fit using Hidden Markov Model (Baum-Welch algorithm)."""
        n_samples, n_features = features.shape

        # Initialize with k-means
        kmeans = KMeans(n_clusters=self.n_regimes, random_state=42, n_init=10)
        initial_labels = kmeans.fit_predict(features)

        # Initialize parameters
        self._emission_means = kmeans.cluster_centers_.copy()
        self._emission_covs = np.array(
            [np.cov(features[initial_labels == k].T) + 0.01 * np.eye(n_features) for k in range(self.n_regimes)]
        )
        self._transition_matrix = self._estimate_transition_matrix(initial_labels)
        self._initial_probs = self._stationary_distribution(self._transition_matrix)

        # Baum-Welch iterations
        for _ in range(50):
            # E-step: Forward-backward
            alpha, beta, gamma, xi = self._forward_backward(features)

            # M-step: Update parameters
            for k in range(self.n_regimes):
                gamma_k = gamma[:, k]
                weight_sum = gamma_k.sum()

                if weight_sum > 0:
                    # Update mean
                    self._emission_means[k] = (gamma_k[:, None] * features).sum(axis=0) / weight_sum

                    # Update covariance
                    diff = features - self._emission_means[k]
                    self._emission_covs[k] = (
                        (gamma_k[:, None, None] * (diff[:, :, None] @ diff[:, None, :])).sum(axis=0)
                        / weight_sum
                    )
                    # Regularize
                    self._emission_covs[k] += 0.01 * np.eye(n_features)

            # Update transition matrix
            for i in range(self.n_regimes):
                for j in range(self.n_regimes):
                    self._transition_matrix[i, j] = xi[:, i, j].sum() / gamma[:-1, i].sum()

            # Update initial probs
            self._initial_probs = gamma[0]

        # Order by emission mean (first feature)
        order = np.argsort(self._emission_means[:, 0])
        self._regime_order = order.tolist()

    def _emission_probability(self, x: NDArray) -> NDArray:
        """Calculate emission probabilities for observation x."""
        probs = np.zeros(self.n_regimes)

        for k in range(self.n_regimes):
            try:
                probs[k] = stats.multivariate_normal.pdf(
                    x, mean=self._emission_means[k], cov=self._emission_covs[k]
                )
            except np.linalg.LinAlgError:
                probs[k] = 1e-10

        return probs / probs.sum() if probs.sum() > 0 else np.ones(self.n_regimes) / self.n_regimes

    def _forward_backward(self, features: NDArray):
        """Forward-backward algorithm for HMM."""
        n_samples = len(features)
        n_states = self.n_regimes

        # Emission probabilities
        B = np.array([self._emission_probability(x) for x in features])

        # Forward pass
        alpha = np.zeros((n_samples, n_states))
        alpha[0] = self._initial_probs * B[0]
        alpha[0] /= alpha[0].sum()

        for t in range(1, n_samples):
            alpha[t] = (alpha[t - 1] @ self._transition_matrix) * B[t]
            alpha[t] /= alpha[t].sum()

        # Backward pass
        beta = np.zeros((n_samples, n_states))
        beta[-1] = 1.0

        for t in range(n_samples - 2, -1, -1):
            beta[t] = self._transition_matrix @ (B[t + 1] * beta[t + 1])
            beta[t] /= beta[t].sum()

        # Gamma (state probabilities)
        gamma = alpha * beta
        gamma /= gamma.sum(axis=1, keepdims=True)

        # Xi (transition probabilities)
        xi = np.zeros((n_samples - 1, n_states, n_states))
        for t in range(n_samples - 1):
            for i in range(n_states):
                for j in range(n_states):
                    xi[t, i, j] = (
                        alpha[t, i]
                        * self._transition_matrix[i, j]
                        * B[t + 1, j]
                        * beta[t + 1, j]
                    )
            xi[t] /= xi[t].sum()

        return alpha, beta, gamma, xi

    def _viterbi(self, features: NDArray) -> Tuple[NDArray, NDArray]:
        """Viterbi algorithm for most likely state sequence."""
        n_samples = len(features)
        n_states = self.n_regimes

        # Emission probabilities
        B = np.array([self._emission_probability(x) for x in features])

        # Viterbi
        delta = np.zeros((n_samples, n_states))
        psi = np.zeros((n_samples, n_states), dtype=int)

        delta[0] = np.log(self._initial_probs + 1e-10) + np.log(B[0] + 1e-10)

        for t in range(1, n_samples):
            for j in range(n_states):
                temp = delta[t - 1] + np.log(self._transition_matrix[:, j] + 1e-10)
                psi[t, j] = np.argmax(temp)
                delta[t, j] = temp[psi[t, j]] + np.log(B[t, j] + 1e-10)

        # Backtrack
        path = np.zeros(n_samples, dtype=int)
        path[-1] = np.argmax(delta[-1])

        for t in range(n_samples - 2, -1, -1):
            path[t] = psi[t + 1, path[t + 1]]

        # Map to regime order
        regime_sequence = np.array([self._regime_order[p] for p in path])

        # Probabilities
        probs = np.exp(delta - delta.max(axis=1, keepdims=True))
        probs /= probs.sum(axis=1, keepdims=True)

        return regime_sequence, probs

    @staticmethod
    def _estimate_transition_matrix(labels: NDArray) -> NDArray:
        """Estimate transition matrix from label sequence."""
        n_states = len(np.unique(labels))
        counts = np.zeros((n_states, n_states))

        for i in range(len(labels) - 1):
            counts[labels[i], labels[i + 1]] += 1

        # Normalize rows
        row_sums = counts.sum(axis=1, keepdims=True)
        row_sums[row_sums == 0] = 1
        return counts / row_sums

    @staticmethod
    def _stationary_distribution(P: NDArray) -> NDArray:
        """Compute stationary distribution of transition matrix."""
        n = P.shape[0]

        # Solve (P^T - I)π = 0 with sum(π) = 1
        A = np.vstack([P.T - np.eye(n), np.ones(n)])
        b = np.zeros(n + 1)
        b[-1] = 1

        # Least squares solution
        pi, _, _, _ = np.linalg.lstsq(A, b, rcond=None)
        pi = np.maximum(pi, 0)
        return pi / pi.sum()
