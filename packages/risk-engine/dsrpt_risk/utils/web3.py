"""
Web3 utilities for interacting with DSRPT Protocol contracts.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Tuple

from eth_abi import encode
from web3 import Web3


def encode_curve_config(config: Dict) -> bytes:
    """
    Encode CurveConfig struct for on-chain call.

    Args:
        config: Dictionary with curve configuration

    Returns:
        ABI-encoded bytes for setCurveConfig call.
    """
    # CurveConfig struct:
    # bytes32 perilId
    # uint32 minPremiumBps
    # uint32 maxMultiplierBps
    # uint8 regime
    # RegimeCurve[3] regimeCurves

    peril_id = config["perilId"]
    if isinstance(peril_id, str):
        peril_id = Web3.keccak(text=peril_id)

    # Encode regime curves
    regime_curves = []
    for rc in config["regimeCurves"]:
        # RegimeCurve: HazardTerm[3] terms, uint224 tailSlope1e18
        terms = rc[:3]  # [(tenorDays, H1e18), ...]
        tail_slope = rc[3]
        regime_curves.append((terms, tail_slope))

    # Note: Full ABI encoding would require the exact struct layout
    # This is a simplified version
    return encode(
        ["bytes32", "uint32", "uint32", "uint8"],
        [peril_id, config["minPremiumBps"], config["maxMultiplierBps"], config["regime"]],
    )


class Web3Client:
    """
    Web3 client for DSRPT Protocol interactions.

    Example:
    --------
    ```python
    client = Web3Client(rpc_url="https://mainnet.base.org")

    # Read oracle state
    state = client.get_oracle_state(peril_id)

    # Read portfolio state
    portfolio = client.get_portfolio_state(peril_id)

    # Push curve update
    tx_hash = client.set_curve_config(config, private_key)
    ```
    """

    def __init__(
        self,
        rpc_url: str | None = None,
        hazard_engine: str | None = None,
        oracle_aggregator: str | None = None,
        treasury_manager: str | None = None,
    ):
        """
        Initialize Web3 client.

        Args:
            rpc_url: RPC endpoint URL
            hazard_engine: HazardEngine contract address
            oracle_aggregator: OracleAggregator contract address
            treasury_manager: TreasuryManager contract address
        """
        self.rpc_url = rpc_url or os.environ.get("RPC_URL", "https://mainnet.base.org")
        self.w3 = Web3(Web3.HTTPProvider(self.rpc_url))

        self.hazard_engine = hazard_engine
        self.oracle_aggregator = oracle_aggregator
        self.treasury_manager = treasury_manager

        # ABIs (simplified)
        self._hazard_abi = self._load_hazard_abi()
        self._oracle_abi = self._load_oracle_abi()

    def get_oracle_state(self, peril_id: bytes | str) -> Dict:
        """
        Read oracle state from HazardEngine.

        Args:
            peril_id: Peril identifier (bytes32 or string)

        Returns:
            OracleState dict with peg_dev_bps, vol_bps, etc.
        """
        if self.hazard_engine is None:
            raise ValueError("HazardEngine address not set")

        if isinstance(peril_id, str):
            peril_id = Web3.keccak(text=peril_id)

        contract = self.w3.eth.contract(
            address=self.hazard_engine, abi=self._hazard_abi
        )

        state = contract.functions.getOracleState(peril_id).call()

        return {
            "updated_at": state[0],
            "peg_dev_bps": state[1],
            "vol_bps": state[2],
            "disagreement_bps": state[3],
            "shock_flag": state[4],
        }

    def get_portfolio_state(self, peril_id: bytes | str) -> Dict:
        """
        Read portfolio state from HazardEngine.

        Args:
            peril_id: Peril identifier

        Returns:
            PortfolioState dict.
        """
        if self.hazard_engine is None:
            raise ValueError("HazardEngine address not set")

        if isinstance(peril_id, str):
            peril_id = Web3.keccak(text=peril_id)

        contract = self.w3.eth.contract(
            address=self.hazard_engine, abi=self._hazard_abi
        )

        state = contract.functions.getPortfolioState(peril_id).call()

        return {
            "utilization_bps": state[0],
            "capital_ratio_bps": state[1],
            "peril_concentration_bps": state[2],
        }

    def get_current_regime(self, peril_id: bytes | str) -> int:
        """
        Get current regime for a peril.

        Args:
            peril_id: Peril identifier

        Returns:
            Regime kind (0=Calm, 1=Volatile, 2=Crisis)
        """
        if self.hazard_engine is None:
            raise ValueError("HazardEngine address not set")

        if isinstance(peril_id, str):
            peril_id = Web3.keccak(text=peril_id)

        contract = self.w3.eth.contract(
            address=self.hazard_engine, abi=self._hazard_abi
        )

        return contract.functions.getCurrentRegime(peril_id).call()

    def quote_premium(
        self,
        peril_id: bytes | str,
        tenor_days: int,
        limit_usd: int,
    ) -> int:
        """
        Get premium quote from HazardEngine.

        Args:
            peril_id: Peril identifier
            tenor_days: Policy duration in days
            limit_usd: Coverage limit in USD (scaled)

        Returns:
            Premium amount in USD (scaled).
        """
        if self.hazard_engine is None:
            raise ValueError("HazardEngine address not set")

        if isinstance(peril_id, str):
            peril_id = Web3.keccak(text=peril_id)

        contract = self.w3.eth.contract(
            address=self.hazard_engine, abi=self._hazard_abi
        )

        return contract.functions.quotePremium(peril_id, tenor_days, limit_usd).call()

    def set_curve_config(
        self,
        config: Dict,
        private_key: str,
    ) -> str:
        """
        Send setCurveConfig transaction.

        Args:
            config: CurveConfig dictionary
            private_key: Signer private key

        Returns:
            Transaction hash.
        """
        if self.hazard_engine is None:
            raise ValueError("HazardEngine address not set")

        contract = self.w3.eth.contract(
            address=self.hazard_engine, abi=self._hazard_abi
        )

        account = self.w3.eth.account.from_key(private_key)

        # Build transaction
        tx = contract.functions.setCurveConfig(config).build_transaction(
            {
                "from": account.address,
                "nonce": self.w3.eth.get_transaction_count(account.address),
                "gas": 500000,
                "gasPrice": self.w3.eth.gas_price,
            }
        )

        # Sign and send
        signed = self.w3.eth.account.sign_transaction(tx, private_key)
        tx_hash = self.w3.eth.send_raw_transaction(signed.rawTransaction)

        return tx_hash.hex()

    def _load_hazard_abi(self) -> List[Dict]:
        """Load simplified HazardEngine ABI."""
        return [
            {
                "name": "getOracleState",
                "type": "function",
                "stateMutability": "view",
                "inputs": [{"name": "perilId", "type": "bytes32"}],
                "outputs": [
                    {"name": "updatedAt", "type": "uint32"},
                    {"name": "pegDevBps", "type": "uint16"},
                    {"name": "volBps", "type": "uint16"},
                    {"name": "disagreementBps", "type": "uint16"},
                    {"name": "shockFlag", "type": "uint8"},
                ],
            },
            {
                "name": "getPortfolioState",
                "type": "function",
                "stateMutability": "view",
                "inputs": [{"name": "perilId", "type": "bytes32"}],
                "outputs": [
                    {"name": "utilizationBps", "type": "uint16"},
                    {"name": "capitalRatioBps", "type": "uint16"},
                    {"name": "perilConcentrationBps", "type": "uint16"},
                ],
            },
            {
                "name": "getCurrentRegime",
                "type": "function",
                "stateMutability": "view",
                "inputs": [{"name": "perilId", "type": "bytes32"}],
                "outputs": [{"name": "regime", "type": "uint8"}],
            },
            {
                "name": "quotePremium",
                "type": "function",
                "stateMutability": "view",
                "inputs": [
                    {"name": "perilId", "type": "bytes32"},
                    {"name": "tenorDays", "type": "uint256"},
                    {"name": "limitUSD", "type": "uint256"},
                ],
                "outputs": [{"name": "premiumUSD", "type": "uint256"}],
            },
            {
                "name": "setCurveConfig",
                "type": "function",
                "stateMutability": "nonpayable",
                "inputs": [
                    {
                        "name": "config",
                        "type": "tuple",
                        "components": [
                            {"name": "perilId", "type": "bytes32"},
                            {"name": "minPremiumBps", "type": "uint32"},
                            {"name": "maxMultiplierBps", "type": "uint32"},
                            {"name": "regime", "type": "uint8"},
                        ],
                    }
                ],
                "outputs": [],
            },
        ]

    def _load_oracle_abi(self) -> List[Dict]:
        """Load simplified OracleAggregator ABI."""
        return [
            {
                "name": "getLatestSnapshot",
                "type": "function",
                "stateMutability": "view",
                "inputs": [{"name": "perilId", "type": "bytes32"}],
                "outputs": [
                    {"name": "timestamp", "type": "uint32"},
                    {"name": "medianPrice", "type": "uint256"},
                    {"name": "minPrice", "type": "uint256"},
                    {"name": "maxPrice", "type": "uint256"},
                    {"name": "feedCount", "type": "uint8"},
                ],
            },
        ]
