"""
DSRPT Risk Engine Daemon - Continuous monitoring and on-chain updates.

This daemon runs as a backend service that:
1. Monitors oracle prices from multiple sources (Chainlink, CoinGecko, DeFiLlama)
2. Classifies market regime using HMM
3. Proposes regime changes when detected
4. Updates oracle state with volatility metrics
5. Optionally triggers hazard curve recalibration

Usage:
    python -m dsrpt_risk.daemon --config config.base.yaml

Environment Variables:
    PRIVATE_KEY: Keeper wallet private key for signing transactions
    RPC_URL: Override RPC endpoint (default: https://mainnet.base.org)
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
from eth_account import Account
from web3 import Web3

from dsrpt_risk.config import Config, load_config

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("dsrpt.daemon")


# Contract ABIs (minimal for daemon operations)
HAZARD_ENGINE_ABI = [
    {
        "type": "function",
        "name": "getCurrentRegime",
        "stateMutability": "view",
        "inputs": [{"name": "perilId", "type": "bytes32"}],
        "outputs": [{"name": "regime", "type": "uint8"}],
    },
    {
        "type": "function",
        "name": "proposeRegimeChange",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "perilId", "type": "bytes32"},
            {"name": "newRegime", "type": "uint8"},
        ],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "keeper",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "address"}],
    },
]

ORACLE_AGGREGATOR_ABI = [
    {
        "type": "function",
        "name": "updateOracleState",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "perilId", "type": "bytes32"}],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "getLatestSnapshot",
        "stateMutability": "view",
        "inputs": [{"name": "perilId", "type": "bytes32"}],
        "outputs": [
            {
                "name": "snapshot",
                "type": "tuple",
                "components": [
                    {"name": "timestamp", "type": "uint32"},
                    {"name": "medianPrice", "type": "uint256"},
                    {"name": "minPrice", "type": "uint256"},
                    {"name": "maxPrice", "type": "uint256"},
                    {"name": "feedCount", "type": "uint8"},
                ],
            }
        ],
    },
    {
        "type": "function",
        "name": "keeper",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "address"}],
    },
]


class OracleData:
    """Aggregated oracle data from multiple sources."""

    def __init__(self):
        self.chainlink_price: float = 1.0
        self.coingecko_price: float = 1.0
        self.defillama_price: float = 1.0
        self.timestamp: datetime = datetime.now()
        self.vol_bps: int = 0
        self.peg_dev_bps: int = 0
        self.disagreement_bps: int = 0
        self.shock_flag: int = 0

    @property
    def avg_price(self) -> float:
        """Average price across sources."""
        return (self.chainlink_price + self.coingecko_price + self.defillama_price) / 3

    def calculate_metrics(self, price_history: list[float]) -> None:
        """Calculate volatility and other metrics from price history."""
        if len(price_history) < 2:
            return

        import numpy as np

        prices = np.array(price_history)
        returns = np.diff(np.log(prices))

        # Annualized volatility in bps
        self.vol_bps = int(np.std(returns) * np.sqrt(365 * 24) * 10000)

        # Peg deviation in bps (can be negative)
        self.peg_dev_bps = int((1 - self.avg_price) * 10000)

        # Cross-venue disagreement
        prices_list = [self.chainlink_price, self.coingecko_price, self.defillama_price]
        self.disagreement_bps = int((max(prices_list) - min(prices_list)) * 10000)

        # Shock detection (sudden large move)
        if len(returns) > 0 and abs(returns[-1]) > 0.01:  # > 1% move
            self.shock_flag = 2 if abs(returns[-1]) > 0.03 else 1
        else:
            self.shock_flag = 0


class RiskEngineDaemon:
    """Main daemon for continuous risk monitoring and on-chain updates."""

    def __init__(self, config: Config):
        self.config = config
        self._running = False
        self._price_history: list[float] = []
        self._last_regime: int = 0
        self._last_oracle_update: datetime | None = None
        self._last_calibration: datetime | None = None

        # Initialize Web3
        rpc_url = os.environ.get("RPC_URL", config.chain.rpc_url)
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))

        # Setup keeper account if private key provided
        private_key = os.environ.get("PRIVATE_KEY")
        if private_key:
            self.account = Account.from_key(private_key)
            self.w3.eth.default_account = self.account.address
            logger.info(f"Keeper account: {self.account.address}")
        else:
            self.account = None
            logger.warning("No PRIVATE_KEY set - running in read-only mode")

        # Initialize contracts
        self.hazard_engine = self.w3.eth.contract(
            address=Web3.to_checksum_address(config.chain.hazard_engine_address),
            abi=HAZARD_ENGINE_ABI,
        )
        self.oracle_aggregator = self.w3.eth.contract(
            address=Web3.to_checksum_address(config.chain.oracle_aggregator_address),
            abi=ORACLE_AGGREGATOR_ABI,
        )

        # HTTP client for API calls
        self.http_client = httpx.AsyncClient(timeout=30.0)

    async def start(self) -> None:
        """Start the daemon."""
        logger.info("Starting DSRPT Risk Engine Daemon")
        self._running = True

        # Setup signal handlers
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, self._signal_handler)

        # Main loop
        while self._running:
            try:
                await self._tick()
            except Exception as e:
                logger.error(f"Error in daemon tick: {e}", exc_info=True)

            await asyncio.sleep(self.config.oracle.update_interval_seconds)

    def stop(self) -> None:
        """Stop the daemon gracefully."""
        logger.info("Stopping daemon...")
        self._running = False

    def _signal_handler(self, signum: int, frame: Any) -> None:
        """Handle shutdown signals."""
        logger.info(f"Received signal {signum}")
        self.stop()

    async def _tick(self) -> None:
        """Single iteration of the daemon loop."""
        logger.debug("Daemon tick")

        # 1. Fetch oracle data
        oracle_data = await self._fetch_oracle_data()
        self._price_history.append(oracle_data.avg_price)

        # Keep last 24 hours of hourly data
        if len(self._price_history) > 24 * 12:  # 5-min intervals
            self._price_history = self._price_history[-24 * 12 :]

        # 2. Calculate metrics
        oracle_data.calculate_metrics(self._price_history)
        logger.info(
            f"Oracle: price={oracle_data.avg_price:.6f}, "
            f"vol={oracle_data.vol_bps}bps, peg_dev={oracle_data.peg_dev_bps}bps, "
            f"disagree={oracle_data.disagreement_bps}bps"
        )

        # 3. Check regime
        await self._check_regime(oracle_data)

        # 4. Update oracle state on-chain
        await self._update_oracle_state(oracle_data)

        # 5. Check if recalibration needed (daily)
        await self._check_calibration()

    async def _fetch_oracle_data(self) -> OracleData:
        """Fetch price data from multiple oracles."""
        data = OracleData()

        # On-chain snapshot (from OracleAggregator)
        try:
            peril_id = bytes.fromhex(self.config.peril_id[2:])
            snapshot = self.oracle_aggregator.functions.getLatestSnapshot(peril_id).call()
            # snapshot is (timestamp, medianPrice, minPrice, maxPrice, feedCount)
            if snapshot[1] > 0:  # medianPrice
                data.chainlink_price = snapshot[1] / 1e18  # Normalized to 1e18
                logger.debug(f"On-chain USDC: {data.chainlink_price}")
        except Exception as e:
            logger.debug(f"On-chain snapshot fetch failed (may not be configured yet): {e}")

        # CoinGecko (off-chain API)
        try:
            resp = await self.http_client.get(
                f"{self.config.oracle.coingecko_api_url}/simple/price",
                params={"ids": "usd-coin", "vs_currencies": "usd"},
            )
            if resp.status_code == 200:
                result = resp.json()
                data.coingecko_price = result.get("usd-coin", {}).get("usd", 1.0)
                logger.debug(f"CoinGecko USDC: {data.coingecko_price}")
        except Exception as e:
            logger.warning(f"CoinGecko fetch failed: {e}")

        # DeFiLlama (off-chain API)
        try:
            resp = await self.http_client.get(
                f"{self.config.oracle.defillama_api_url}/prices/current/base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
            )
            if resp.status_code == 200:
                result = resp.json()
                coins = result.get("coins", {})
                for key, val in coins.items():
                    data.defillama_price = val.get("price", 1.0)
                    break
                logger.debug(f"DeFiLlama USDC: {data.defillama_price}")
        except Exception as e:
            logger.warning(f"DeFiLlama fetch failed: {e}")

        data.timestamp = datetime.now()
        return data

    async def _check_regime(self, oracle_data: OracleData) -> None:
        """Check if regime change is needed and propose if so."""
        peril_id = bytes.fromhex(self.config.peril_id[2:])  # Remove 0x prefix

        # Get current on-chain regime
        try:
            current_regime = self.hazard_engine.functions.getCurrentRegime(
                peril_id
            ).call()
        except Exception as e:
            logger.error(f"Failed to get current regime: {e}")
            return

        # Simple regime classification based on metrics
        # 0 = CALM, 1 = VOLATILE, 2 = CRISIS
        proposed_regime = 0

        if oracle_data.shock_flag == 2 or abs(oracle_data.peg_dev_bps) > 300:
            proposed_regime = 2  # CRISIS
        elif (
            oracle_data.vol_bps > self.config.hedging.vol_threshold_high_bps
            or oracle_data.shock_flag == 1
            or abs(oracle_data.peg_dev_bps) > 100
        ):
            proposed_regime = 1  # VOLATILE
        else:
            proposed_regime = 0  # CALM

        # Check if regime changed
        if proposed_regime != current_regime:
            logger.info(
                f"Regime change detected: {current_regime} -> {proposed_regime}"
            )

            if self.account:
                await self._propose_regime_change(peril_id, proposed_regime)
            else:
                logger.warning("Cannot propose regime change - no private key")

        self._last_regime = current_regime

    async def _propose_regime_change(
        self, peril_id: bytes, new_regime: int
    ) -> None:
        """Submit regime change proposal on-chain."""
        try:
            tx = self.hazard_engine.functions.proposeRegimeChange(
                peril_id, new_regime
            ).build_transaction(
                {
                    "from": self.account.address,
                    "nonce": self.w3.eth.get_transaction_count(self.account.address),
                    "gas": 200000,
                    "maxFeePerGas": self.w3.eth.gas_price * 2,
                    "maxPriorityFeePerGas": self.w3.to_wei(0.001, "gwei"),
                }
            )

            signed = self.account.sign_transaction(tx)
            tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
            logger.info(f"Regime change tx submitted: {tx_hash.hex()}")

            # Wait for confirmation
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            if receipt.status == 1:
                logger.info(f"Regime change confirmed in block {receipt.blockNumber}")
            else:
                logger.error("Regime change transaction reverted")

        except Exception as e:
            logger.error(f"Failed to submit regime change: {e}")

    async def _update_oracle_state(self, oracle_data: OracleData) -> None:
        """Update oracle state on-chain by triggering the OracleAggregator."""
        # Rate limit updates (every 5 minutes)
        if self._last_oracle_update:
            elapsed = (datetime.now() - self._last_oracle_update).total_seconds()
            if elapsed < self.config.oracle.update_interval_seconds:
                return

        if not self.account:
            logger.debug("Skipping oracle update - read-only mode")
            return

        peril_id = bytes.fromhex(self.config.peril_id[2:])

        try:
            # The contract's updateOracleState(perilId) fetches from on-chain Chainlink feeds
            # and pushes the computed state to the HazardEngine
            tx = self.oracle_aggregator.functions.updateOracleState(
                peril_id
            ).build_transaction(
                {
                    "from": self.account.address,
                    "nonce": self.w3.eth.get_transaction_count(self.account.address),
                    "gas": 300000,  # Higher gas for multi-feed aggregation
                    "maxFeePerGas": self.w3.eth.gas_price * 2,
                    "maxPriorityFeePerGas": self.w3.to_wei(0.001, "gwei"),
                }
            )

            signed = self.account.sign_transaction(tx)
            tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
            logger.info(f"Oracle update tx submitted: {tx_hash.hex()}")

            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            if receipt.status == 1:
                logger.info(f"Oracle update confirmed in block {receipt.blockNumber}")
                self._last_oracle_update = datetime.now()
            else:
                logger.error("Oracle update transaction reverted")

        except Exception as e:
            logger.error(f"Failed to update oracle state: {e}")

    async def _check_calibration(self) -> None:
        """Check if hazard curve recalibration is needed."""
        # Daily recalibration
        if self._last_calibration:
            elapsed = datetime.now() - self._last_calibration
            if elapsed < timedelta(hours=24):
                return

        logger.info("Running hazard curve recalibration...")

        try:
            from dsrpt_risk import RiskEngine
            import numpy as np

            # In production, fetch real historical data
            # For now, use price history collected by daemon
            if len(self._price_history) < 100:
                logger.warning("Insufficient price history for calibration")
                return

            engine = RiskEngine(self.config)
            engine.load_data(np.array(self._price_history))

            regime = engine.classify_regime()
            logger.info(f"Current regime classification: {regime.name}")

            # Full calibration would run here
            # curves = engine.calibrate()
            # tx_data = engine.generate_curve_update_tx(curves)

            self._last_calibration = datetime.now()

        except Exception as e:
            logger.error(f"Calibration failed: {e}", exc_info=True)

    async def close(self) -> None:
        """Cleanup resources."""
        await self.http_client.aclose()


async def main(config_path: str | None = None) -> None:
    """Main entry point."""
    config = load_config(config_path)

    daemon = RiskEngineDaemon(config)

    try:
        await daemon.start()
    finally:
        await daemon.close()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="DSRPT Risk Engine Daemon")
    parser.add_argument("--config", "-c", help="Path to config file")
    args = parser.parse_args()

    asyncio.run(main(args.config))
