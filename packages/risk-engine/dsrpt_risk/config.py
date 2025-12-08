"""
Configuration management for DSRPT Risk Engine.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field


class ChainConfig(BaseModel):
    """Blockchain configuration."""

    rpc_url: str = Field(default="https://mainnet.base.org")
    chain_id: int = Field(default=8453)
    hazard_engine_address: str = Field(default="")
    oracle_aggregator_address: str = Field(default="")
    treasury_manager_address: str = Field(default="")
    policy_manager_address: str = Field(default="")


class OracleConfig(BaseModel):
    """Oracle data source configuration."""

    chainlink_usdc_usd: str = Field(default="0x2489462e64Ea205386b7b8737609B3701047a77d")
    coingecko_api_url: str = Field(default="https://api.coingecko.com/api/v3")
    defillama_api_url: str = Field(default="https://coins.llama.fi")
    update_interval_seconds: int = Field(default=300)


class EVTConfig(BaseModel):
    """Extreme Value Theory model configuration."""

    threshold_quantile: float = Field(default=0.95, ge=0.9, le=0.99)
    min_excesses: int = Field(default=30)
    block_size_days: int = Field(default=7)
    confidence_level: float = Field(default=0.95)


class HawkesConfig(BaseModel):
    """Hawkes process model configuration."""

    baseline_intensity: float = Field(default=0.01)
    alpha: float = Field(default=0.5)
    beta: float = Field(default=1.0)
    min_events: int = Field(default=10)


class RegimeConfig(BaseModel):
    """Regime classifier configuration."""

    n_regimes: int = Field(default=3)
    features: list[str] = Field(
        default=["volatility", "max_drawdown", "cross_venue_spread", "depth_to_1pct"]
    )
    lookback_days: int = Field(default=30)
    min_samples_per_regime: int = Field(default=50)


class HazardConfig(BaseModel):
    """Hazard curve configuration."""

    tenors_days: list[int] = Field(default=[7, 30, 90])
    simulation_count: int = Field(default=10000)
    trigger_threshold: float = Field(default=0.97)
    trigger_duration_hours: int = Field(default=24)


class HedgingConfig(BaseModel):
    """Meta-hedging configuration."""

    vol_threshold_low_bps: int = Field(default=200)
    vol_threshold_high_bps: int = Field(default=800)
    liquidity_threshold_bps: int = Field(default=50)
    book_exposure_pct: float = Field(default=0.20)
    rebalance_interval_hours: int = Field(default=24)


class Config(BaseModel):
    """Main configuration for DSRPT Risk Engine."""

    chain: ChainConfig = Field(default_factory=ChainConfig)
    oracle: OracleConfig = Field(default_factory=OracleConfig)
    evt: EVTConfig = Field(default_factory=EVTConfig)
    hawkes: HawkesConfig = Field(default_factory=HawkesConfig)
    regime: RegimeConfig = Field(default_factory=RegimeConfig)
    hazard: HazardConfig = Field(default_factory=HazardConfig)
    hedging: HedgingConfig = Field(default_factory=HedgingConfig)

    # Peril configuration
    peril_id: str = Field(default="USDC_depeg")

    # Logging
    log_level: str = Field(default="INFO")
    log_file: str | None = Field(default=None)


def load_config(path: str | Path | None = None) -> Config:
    """
    Load configuration from YAML file.

    Args:
        path: Path to config file. If None, uses DSRPT_CONFIG env var
              or defaults to config.yaml in current directory.

    Returns:
        Config object with loaded settings.
    """
    if path is None:
        path = os.environ.get("DSRPT_CONFIG", "config.yaml")

    path = Path(path)

    if path.exists():
        with open(path) as f:
            data = yaml.safe_load(f) or {}
        return Config(**data)

    return Config()


def save_config(config: Config, path: str | Path) -> None:
    """
    Save configuration to YAML file.

    Args:
        config: Config object to save.
        path: Path to save to.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with open(path, "w") as f:
        yaml.dump(config.model_dump(), f, default_flow_style=False)


# Default configuration template
DEFAULT_CONFIG_YAML = """
# DSRPT Risk Engine Configuration

chain:
  rpc_url: "https://mainnet.base.org"
  chain_id: 8453
  hazard_engine_address: ""
  oracle_aggregator_address: ""
  treasury_manager_address: ""
  policy_manager_address: ""

oracle:
  chainlink_usdc_usd: "0x2489462e64Ea205386b7b8737609B3701047a77d"
  update_interval_seconds: 300

evt:
  threshold_quantile: 0.95
  min_excesses: 30
  block_size_days: 7
  confidence_level: 0.95

hawkes:
  baseline_intensity: 0.01
  alpha: 0.5
  beta: 1.0
  min_events: 10

regime:
  n_regimes: 3
  features:
    - volatility
    - max_drawdown
    - cross_venue_spread
    - depth_to_1pct
  lookback_days: 30
  min_samples_per_regime: 50

hazard:
  tenors_days: [7, 30, 90]
  simulation_count: 10000
  trigger_threshold: 0.97
  trigger_duration_hours: 24

hedging:
  vol_threshold_low_bps: 200
  vol_threshold_high_bps: 800
  liquidity_threshold_bps: 50
  book_exposure_pct: 0.20
  rebalance_interval_hours: 24

peril_id: "USDC_depeg"
log_level: "INFO"
"""
