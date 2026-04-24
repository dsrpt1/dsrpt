"""
Dsrpt Terminal — Chain Relay

Submits regime transitions to OracleAdapter on Base.
Called from runner.py alongside Telegram alerts — same process
that detects the signal also submits the tx. Zero intermediate latency.

Env vars:
  DSRPT_RPC_URL          — Base RPC endpoint (default: https://mainnet.base.org)
  DSRPT_RELAYER_KEY      — Private key of the signal relayer EOA
  DSRPT_ADAPTER_ADDRESS  — Deployed OracleAdapter contract address
"""

import os
import time
import logging
from typing import Optional

try:
    from web3 import Web3
    try:
        from web3.middleware import ExtraDataToPOAMiddleware
    except ImportError:
        ExtraDataToPOAMiddleware = None
    HAS_WEB3 = True
except ImportError:
    HAS_WEB3 = False

log = logging.getLogger("chain_relay")

# Regime name -> uint8 (matches OracleAdapter.Regime enum)
REGIME_TO_ID = {
    "ambiguous":             0,
    "contained_stress":      1,
    "liquidity_dislocation": 2,
    "collateral_shock":      3,
    "reflexive_collapse":    4,
}

# Minimal ABI for OracleAdapter.updateRegime()
ADAPTER_ABI = [
    {
        "type": "function",
        "name": "updateRegime",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "asset",      "type": "address"},
            {"name": "regimeId",   "type": "uint8"},
            {"name": "confidence", "type": "uint256"},
            {"name": "pegDevBps",  "type": "uint16"},
            {"name": "volBps",     "type": "uint16"},
        ],
        "outputs": [],
    },
]

# ABI for OracleAggregator.recordSnapshot()
AGGREGATOR_ABI = [
    {
        "type": "function",
        "name": "recordSnapshot",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "perilId", "type": "bytes32"}],
        "outputs": [],
    },
]

# Peril IDs (must match on-chain)
PERIL_IDS = {
    "USDC": "0x6cdb2b1f320420e8bcd2f00c91695a104bd6066ad93d0ccbd0195a603747ed1f",
    "USDT": "0x073146c315d13913647c4f8d0fe5ef4976515fef6adcdef2261fdb55bf15b16a",
}

# USDC on Base
ASSET_ADDRESSES = {
    "USDC": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "USDT": "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    "DAI":  "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    "FRAX": "0x0000000000000000000000000000000000000000",  # not on Base yet
}

MAX_RETRIES = 3
RETRY_DELAYS = [2, 4, 8]  # exponential backoff


class ChainRelay:
    """Submits regime updates to OracleAdapter on-chain."""

    def __init__(self):
        self.enabled = False
        self.w3 = None
        self.account = None
        self.contract = None
        self.adapter_address = None
        self.last_tx_hash = None

        rpc_url = os.environ.get("DSRPT_RPC_URL", "")
        relayer_key = os.environ.get("DSRPT_RELAYER_KEY", "")
        adapter_addr = os.environ.get("DSRPT_ADAPTER_ADDRESS", "")

        if not all([rpc_url, relayer_key, adapter_addr]):
            log.info("Chain relay not configured (missing env vars) — console only")
            return

        if not HAS_WEB3:
            log.warning("web3 not installed — chain relay disabled")
            return

        try:
            self.w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 30}))
            if ExtraDataToPOAMiddleware is not None:
                self.w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)

            if not self.w3.is_connected():
                log.error(f"Cannot connect to RPC: {rpc_url}")
                return

            self.account = self.w3.eth.account.from_key(relayer_key)
            self.adapter_address = Web3.to_checksum_address(adapter_addr)
            self.contract = self.w3.eth.contract(
                address=self.adapter_address,
                abi=ADAPTER_ABI,
            )

            # OracleAggregator for refreshing price snapshots
            aggregator_addr = os.environ.get(
                "DSRPT_AGGREGATOR_ADDRESS",
                "0xB203E42D84B70a60E3032F5Ed661C50cc7E9e3Cb",
            )
            self.aggregator = self.w3.eth.contract(
                address=Web3.to_checksum_address(aggregator_addr),
                abi=AGGREGATOR_ABI,
            )

            self.enabled = True

            chain_id = self.w3.eth.chain_id
            balance = self.w3.eth.get_balance(self.account.address)
            balance_eth = self.w3.from_wei(balance, "ether")
            log.info(
                f"Chain relay online: relayer={self.account.address} "
                f"adapter={self.adapter_address} chain={chain_id} "
                f"balance={balance_eth:.4f} ETH"
            )
        except Exception as e:
            log.error(f"Chain relay init failed: {e}")
            self.enabled = False

    def relay(
        self,
        asset: str,
        regime: str,
        confidence: float,
        current_price: float,
        max_severity: float,
    ) -> Optional[str]:
        """
        Submit regime update to OracleAdapter.

        Args:
            asset: Asset symbol (e.g., "USDC")
            regime: Regime name from classifier_v2 (e.g., "contained_stress")
            confidence: Partial score 0.0-1.0
            current_price: Latest price (e.g., 0.9985)
            max_severity: Peak severity in window

        Returns:
            Transaction hash if successful, None otherwise.
        """
        if not self.enabled:
            return None

        asset_address = ASSET_ADDRESSES.get(asset)
        if not asset_address or asset_address == "0x" + "0" * 40:
            log.warning(f"No on-chain address for {asset} — skipping relay")
            return None

        regime_id = REGIME_TO_ID.get(regime)
        if regime_id is None:
            log.error(f"Unknown regime: {regime}")
            return None

        # Convert confidence (0-1 float) to bps (0-10000)
        confidence_bps = min(10000, max(0, int(confidence * 10000)))

        # Peg deviation: |1.0 - price| in bps
        peg_dev_bps = min(65535, max(0, int(abs(1.0 - current_price) * 10000)))

        # Volatility proxy: max_severity scaled to bps
        vol_bps = min(65535, max(0, int(max_severity * 10000)))

        log.info(
            f"Relaying: {asset} regime={regime}({regime_id}) "
            f"conf={confidence_bps}bps pegDev={peg_dev_bps}bps vol={vol_bps}bps"
        )

        for attempt in range(MAX_RETRIES):
            try:
                tx_hash = self._send_tx(
                    asset_address, regime_id, confidence_bps, peg_dev_bps, vol_bps
                )
                self.last_tx_hash = tx_hash
                log.info(f"Tx sent: {tx_hash}")
                return tx_hash
            except Exception as e:
                delay = RETRY_DELAYS[attempt] if attempt < len(RETRY_DELAYS) else 8
                log.warning(f"Relay attempt {attempt + 1} failed: {e} — retrying in {delay}s")
                time.sleep(delay)

        log.error(f"Relay failed after {MAX_RETRIES} attempts")
        return None

    def _send_tx(
        self,
        asset_address: str,
        regime_id: int,
        confidence_bps: int,
        peg_dev_bps: int,
        vol_bps: int,
    ) -> str:
        nonce = self.w3.eth.get_transaction_count(self.account.address, "pending")

        tx = self.contract.functions.updateRegime(
            Web3.to_checksum_address(asset_address),
            regime_id,
            confidence_bps,
            peg_dev_bps,
            vol_bps,
        ).build_transaction({
            "from":     self.account.address,
            "nonce":    nonce,
            "gas":      200_000,
            "maxFeePerGas":         self.w3.eth.gas_price * 2,
            "maxPriorityFeePerGas": self.w3.to_wei(0.001, "gwei"),
            "chainId":  self.w3.eth.chain_id,
        })

        signed = self.account.sign_transaction(tx)
        raw = getattr(signed, 'raw_transaction', None) or getattr(signed, 'rawTransaction', None)
        tx_hash = self.w3.eth.send_raw_transaction(raw)
        return tx_hash.hex()

    def refresh_oracle(self, asset: str) -> Optional[str]:
        """
        Call OracleAggregator.recordSnapshot() to refresh the on-chain
        Chainlink price for a given asset. Called every poll tick.
        """
        if not self.enabled:
            return None

        peril_id = PERIL_IDS.get(asset)
        if not peril_id:
            return None

        try:
            nonce = self.w3.eth.get_transaction_count(self.account.address, "pending")

            tx = self.aggregator.functions.recordSnapshot(
                peril_id,
            ).build_transaction({
                "from":     self.account.address,
                "nonce":    nonce,
                "gas":      150_000,
                "maxFeePerGas":         self.w3.eth.gas_price * 2,
                "maxPriorityFeePerGas": self.w3.to_wei(0.001, "gwei"),
                "chainId":  self.w3.eth.chain_id,
            })

            signed = self.account.sign_transaction(tx)
            raw = getattr(signed, 'raw_transaction', None) or getattr(signed, 'rawTransaction', None)
        tx_hash = self.w3.eth.send_raw_transaction(raw)
            return tx_hash.hex()
        except Exception as e:
            log.warning(f"Oracle refresh failed for {asset}: {e}")
            return None
