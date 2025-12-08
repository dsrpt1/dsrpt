"""
Meta-Hedging Position Manager for DSRPT Protocol.

Manages derivative positions that hedge the protocol's premium income
against changes in market conditions.

Strategy:
---------
1. VOLATILITY HEDGE
   - Low vol → Low premiums → Sell vol to collect income
   - High vol → High premiums → Buy vol to hedge income drop

2. LIQUIDITY HEDGE
   - Thin liquidity → High premiums → Provide MM to earn spreads
   - Deep liquidity → Low premiums → Withdraw MM capital

3. SYSTEMIC STRESS HEDGE
   - Banking shock risk → High premiums → Buy credit protection
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional

import numpy as np


class HedgeType(Enum):
    """Types of hedging instruments."""

    VOLATILITY_LONG = "vol_long"  # Long volatility (buy options/straddles)
    VOLATILITY_SHORT = "vol_short"  # Short volatility (sell options)
    LIQUIDITY_PROVIDE = "lp_provide"  # Provide LP to DEX pools
    LIQUIDITY_WITHDRAW = "lp_withdraw"  # Withdraw LP from pools
    CREDIT_PROTECTION = "cds_buy"  # Buy credit default swaps
    INTEREST_RATE = "rate_hedge"  # Interest rate hedges


@dataclass
class HedgePosition:
    """A single hedging position."""

    hedge_type: HedgeType
    underlying: str  # Asset being hedged (e.g., "USDC", "ETH")
    notional: float  # Notional amount in USD
    entry_price: float = 0.0
    current_price: float = 0.0
    entry_time: datetime = field(default_factory=datetime.now)
    expiry_days: int = 30
    strike: float | None = None
    rationale: str = ""

    @property
    def pnl(self) -> float:
        """Calculate current P&L."""
        if self.entry_price == 0:
            return 0.0
        return (self.current_price - self.entry_price) * self.notional

    @property
    def days_to_expiry(self) -> int:
        """Days until position expires."""
        elapsed = (datetime.now() - self.entry_time).days
        return max(0, self.expiry_days - elapsed)


@dataclass
class OracleSnapshot:
    """Snapshot of oracle state for hedging decisions."""

    peg_dev_bps: int
    vol_bps: int
    disagreement_bps: int
    shock_flag: int
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class PortfolioSnapshot:
    """Snapshot of portfolio state for hedging decisions."""

    book_notional: float  # Total policy notional
    expected_premium: float  # Expected annual premium income
    utilization_bps: int
    capital_ratio_bps: int


class MetaHedger:
    """
    Meta-Hedging Position Manager.

    Manages derivative positions that stabilize total protocol income
    (premiums + hedge P&L) across different market regimes.

    Example:
    --------
    ```python
    hedger = MetaHedger(
        vol_threshold_low_bps=200,
        vol_threshold_high_bps=800,
        book_exposure_pct=0.20
    )

    # Compute hedge recommendations
    positions = hedger.compute_hedge_positions(
        oracle_state=oracle_snapshot,
        portfolio_state=portfolio_snapshot
    )

    # Execute via strategy vault or broker
    for pos in positions:
        execute_hedge(pos)
    ```
    """

    def __init__(
        self,
        vol_threshold_low_bps: int = 200,
        vol_threshold_high_bps: int = 800,
        liquidity_threshold_bps: int = 50,
        book_exposure_pct: float = 0.20,
        rebalance_interval_hours: int = 24,
    ):
        """
        Initialize hedger with thresholds.

        Args:
            vol_threshold_low_bps: Below this, sell vol (collect premium)
            vol_threshold_high_bps: Above this, buy vol (hedge income drop)
            liquidity_threshold_bps: Disagreement threshold for liquidity hedges
            book_exposure_pct: Percentage of book notional to hedge
            rebalance_interval_hours: Minimum hours between rebalances
        """
        self.vol_threshold_low = vol_threshold_low_bps
        self.vol_threshold_high = vol_threshold_high_bps
        self.liquidity_threshold = liquidity_threshold_bps
        self.book_exposure = book_exposure_pct
        self.rebalance_interval = rebalance_interval_hours

        # Current positions
        self._positions: List[HedgePosition] = []
        self._last_rebalance: datetime | None = None

    @property
    def positions(self) -> List[HedgePosition]:
        """Get current hedge positions."""
        return self._positions.copy()

    @property
    def total_notional(self) -> float:
        """Total notional across all positions."""
        return sum(p.notional for p in self._positions)

    @property
    def total_pnl(self) -> float:
        """Total P&L across all positions."""
        return sum(p.pnl for p in self._positions)

    def compute_hedge_positions(
        self,
        oracle_state: OracleSnapshot,
        portfolio_state: PortfolioSnapshot,
    ) -> List[HedgePosition]:
        """
        Compute recommended hedge positions based on current state.

        Args:
            oracle_state: Current market conditions from oracle
            portfolio_state: Current portfolio state

        Returns:
            List of recommended HedgePosition objects.
        """
        hedges: List[HedgePosition] = []
        book_notional = portfolio_state.book_notional

        # 1. VOLATILITY HEDGE
        vol_hedge = self._compute_volatility_hedge(oracle_state, book_notional)
        if vol_hedge:
            hedges.append(vol_hedge)

        # 2. LIQUIDITY HEDGE
        liquidity_hedge = self._compute_liquidity_hedge(oracle_state, book_notional)
        if liquidity_hedge:
            hedges.append(liquidity_hedge)

        # 3. SYSTEMIC STRESS HEDGE
        stress_hedge = self._compute_stress_hedge(oracle_state, book_notional)
        if stress_hedge:
            hedges.append(stress_hedge)

        return hedges

    def _compute_volatility_hedge(
        self,
        oracle: OracleSnapshot,
        book_notional: float,
    ) -> HedgePosition | None:
        """Compute volatility hedge based on current vol level."""
        vol_bps = oracle.vol_bps
        hedge_notional = book_notional * self.book_exposure

        if vol_bps < self.vol_threshold_low:
            # Low vol → Low premiums → Sell vol to collect income
            return HedgePosition(
                hedge_type=HedgeType.VOLATILITY_SHORT,
                underlying="USDC",
                notional=hedge_notional,
                strike=1.00,
                expiry_days=30,
                rationale=(
                    f"Low vol ({vol_bps} bps) → low premium income → "
                    "sell straddle to collect option premium"
                ),
            )

        elif vol_bps > self.vol_threshold_high:
            # High vol → High premiums → Buy vol to hedge income drop
            return HedgePosition(
                hedge_type=HedgeType.VOLATILITY_LONG,
                underlying="USDC",
                notional=hedge_notional,
                strike=1.00,
                expiry_days=30,
                rationale=(
                    f"High vol ({vol_bps} bps) → high premium income → "
                    "buy straddle to hedge income drop when vol normalizes"
                ),
            )

        return None

    def _compute_liquidity_hedge(
        self,
        oracle: OracleSnapshot,
        book_notional: float,
    ) -> HedgePosition | None:
        """Compute liquidity provision hedge."""
        disagreement_bps = oracle.disagreement_bps
        hedge_notional = book_notional * 0.15  # 15% of book

        if disagreement_bps > self.liquidity_threshold:
            # Wide spreads → High premiums → Provide liquidity to earn spreads
            return HedgePosition(
                hedge_type=HedgeType.LIQUIDITY_PROVIDE,
                underlying="USDC",
                notional=hedge_notional,
                rationale=(
                    f"High disagreement ({disagreement_bps} bps) → thin liquidity → "
                    "provide LP to earn wide spreads matching high premium income"
                ),
            )
        else:
            # Tight spreads → Low premiums → Withdraw LP capital
            return HedgePosition(
                hedge_type=HedgeType.LIQUIDITY_WITHDRAW,
                underlying="USDC",
                notional=hedge_notional,
                rationale=(
                    f"Low disagreement ({disagreement_bps} bps) → deep liquidity → "
                    "withdraw LP to avoid impermanent loss in tight spread environment"
                ),
            )

    def _compute_stress_hedge(
        self,
        oracle: OracleSnapshot,
        book_notional: float,
    ) -> HedgePosition | None:
        """Compute systemic stress hedge."""
        if oracle.shock_flag >= 1:
            # Shock detected → Buy credit protection
            hedge_notional = book_notional * 0.10  # 10% of book

            return HedgePosition(
                hedge_type=HedgeType.CREDIT_PROTECTION,
                underlying="FINANCIALS",  # Bank CDS basket
                notional=hedge_notional,
                expiry_days=365,
                rationale=(
                    f"Shock flag ({oracle.shock_flag}) → systemic stress → "
                    "buy CDS on bank basket to hedge tail risk of USDC backing"
                ),
            )

        return None

    def apply_positions(self, positions: List[HedgePosition]) -> None:
        """
        Apply computed positions to internal state.

        Args:
            positions: List of positions to apply.
        """
        self._positions = positions
        self._last_rebalance = datetime.now()

    def should_rebalance(self) -> bool:
        """Check if rebalance is needed based on time interval."""
        if self._last_rebalance is None:
            return True

        hours_since = (datetime.now() - self._last_rebalance).total_seconds() / 3600
        return hours_since >= self.rebalance_interval

    def calculate_hedge_pnl(
        self,
        premium_income: float,
        hedge_pnl: float,
    ) -> Dict[str, float]:
        """
        Calculate combined P&L breakdown.

        Args:
            premium_income: Premium income for period
            hedge_pnl: P&L from hedge positions

        Returns:
            Dictionary with P&L breakdown.
        """
        total = premium_income + hedge_pnl

        return {
            "premium_income": premium_income,
            "hedge_pnl": hedge_pnl,
            "total_income": total,
            "hedge_ratio": abs(hedge_pnl / premium_income) if premium_income != 0 else 0,
            "stabilization": 1 - abs(hedge_pnl / premium_income) if premium_income != 0 else 1,
        }

    def generate_execution_plan(
        self,
        positions: List[HedgePosition],
    ) -> Dict[str, any]:
        """
        Generate execution plan for hedge positions.

        Returns structured data for execution via:
        - DeFi strategy vaults
        - Prime broker APIs
        - Manual execution

        Args:
            positions: Positions to execute.

        Returns:
            Execution plan dictionary.
        """
        plan = {
            "timestamp": datetime.now().isoformat(),
            "defi_positions": [],
            "tradfi_positions": [],
            "manual_positions": [],
        }

        for pos in positions:
            entry = {
                "type": pos.hedge_type.value,
                "underlying": pos.underlying,
                "notional": pos.notional,
                "strike": pos.strike,
                "expiry_days": pos.expiry_days,
                "rationale": pos.rationale,
            }

            if pos.hedge_type in [HedgeType.LIQUIDITY_PROVIDE, HedgeType.LIQUIDITY_WITHDRAW]:
                # DeFi execution
                entry["pools"] = ["Curve_USDC_USDT", "UniV3_USDC_ETH"]
                entry["protocol"] = "uniswap_v3" if pos.hedge_type == HedgeType.LIQUIDITY_PROVIDE else "withdraw"
                plan["defi_positions"].append(entry)

            elif pos.hedge_type == HedgeType.CREDIT_PROTECTION:
                # TradFi execution
                entry["entities"] = ["JPM", "BAC", "WFC", "USB"]
                entry["tenor"] = "1Y"
                plan["tradfi_positions"].append(entry)

            else:
                # Options (could be DeFi or TradFi)
                entry["instrument"] = "straddle"
                plan["defi_positions"].append(entry)

        return plan

    def backtest(
        self,
        oracle_history: List[OracleSnapshot],
        portfolio_history: List[PortfolioSnapshot],
        premium_history: List[float],
    ) -> Dict[str, any]:
        """
        Backtest hedging strategy on historical data.

        Args:
            oracle_history: Historical oracle snapshots
            portfolio_history: Historical portfolio snapshots
            premium_history: Historical premium income

        Returns:
            Backtest results including Sharpe ratio, drawdown, etc.
        """
        if len(oracle_history) != len(portfolio_history) != len(premium_history):
            raise ValueError("History arrays must have same length")

        n = len(oracle_history)
        hedge_pnls = []
        total_incomes = []

        for i in range(n):
            # Compute hedge positions
            positions = self.compute_hedge_positions(
                oracle_history[i], portfolio_history[i]
            )

            # Estimate hedge P&L (simplified)
            hedge_pnl = self._estimate_hedge_pnl(positions, oracle_history, i)
            hedge_pnls.append(hedge_pnl)

            # Total income
            total = premium_history[i] + hedge_pnl
            total_incomes.append(total)

        # Calculate metrics
        premium_vol = np.std(premium_history)
        total_vol = np.std(total_incomes)
        vol_reduction = 1 - total_vol / premium_vol if premium_vol > 0 else 0

        premium_sharpe = np.mean(premium_history) / premium_vol if premium_vol > 0 else 0
        total_sharpe = np.mean(total_incomes) / total_vol if total_vol > 0 else 0

        return {
            "n_periods": n,
            "total_premium": sum(premium_history),
            "total_hedge_pnl": sum(hedge_pnls),
            "net_income": sum(total_incomes),
            "premium_volatility": premium_vol,
            "hedged_volatility": total_vol,
            "volatility_reduction": vol_reduction,
            "premium_sharpe": premium_sharpe,
            "hedged_sharpe": total_sharpe,
            "sharpe_improvement": total_sharpe - premium_sharpe,
        }

    def _estimate_hedge_pnl(
        self,
        positions: List[HedgePosition],
        oracle_history: List[OracleSnapshot],
        current_idx: int,
    ) -> float:
        """Estimate hedge P&L based on positions and market changes."""
        if current_idx == 0 or not positions:
            return 0.0

        pnl = 0.0
        prev_oracle = oracle_history[current_idx - 1]
        curr_oracle = oracle_history[current_idx]

        for pos in positions:
            if pos.hedge_type == HedgeType.VOLATILITY_LONG:
                # Long vol profits when vol increases
                vol_change = (curr_oracle.vol_bps - prev_oracle.vol_bps) / 10000
                pnl += pos.notional * vol_change * 0.1  # Simplified vega

            elif pos.hedge_type == HedgeType.VOLATILITY_SHORT:
                # Short vol profits when vol decreases + theta decay
                vol_change = (curr_oracle.vol_bps - prev_oracle.vol_bps) / 10000
                pnl -= pos.notional * vol_change * 0.1
                pnl += pos.notional * 0.001  # Theta decay income

            elif pos.hedge_type == HedgeType.LIQUIDITY_PROVIDE:
                # LP earns spread income
                spread_income = pos.notional * (curr_oracle.disagreement_bps / 10000) * 0.5
                pnl += spread_income

            elif pos.hedge_type == HedgeType.CREDIT_PROTECTION:
                # CDS pays on stress increase
                if curr_oracle.shock_flag > prev_oracle.shock_flag:
                    pnl += pos.notional * 0.02  # 2% payoff on stress increase

        return pnl
