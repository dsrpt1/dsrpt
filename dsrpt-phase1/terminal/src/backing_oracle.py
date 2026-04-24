"""
Dsrpt Terminal — Backing Ratio Oracle

Fetches backing ratios (R = totalBacking / totalSupply) for wrapped
assets by querying L1 and Base on-chain data, then pushes to the
BackingRatioOracle contract on Base via the ContagionTrigger.

Data sources per asset:
  rsETH  — L1: Kelp LRTDepositPool.getTotalAssetDeposits()
           Base: rsETH.totalSupply()
  wstETH — L1: stETH.getTotalPooledEther() / wstETH exchange rate
           Base: wstETH.totalSupply()
  cbETH  — L1: cbETH.exchangeRate() (Coinbase attested)
           Base: cbETH.totalSupply()
  rETH   — L1: RocketTokenRETH.getTotalCollateral()
           Base: rETH.totalSupply()
  weETH  — L1: eETH.totalSupply() via LiquidityPool
           Base: weETH.totalSupply()

Env vars:
  DSRPT_RPC_URL          — Base RPC (already set)
  DSRPT_L1_RPC_URL       — Ethereum L1 RPC (Alchemy/Infura)
  DSRPT_RELAYER_KEY      — Keeper private key (already set)
"""

import os
import logging
import time
from typing import Optional

log = logging.getLogger("backing_oracle")

try:
    from web3 import Web3
    HAS_WEB3 = True
except ImportError:
    HAS_WEB3 = False

# ── Contract addresses ──

# Base Mainnet
CONTAGION_TRIGGER = "0x8cb4756ce55a90495468C13A86f481a05A613930"

WRAPPED_TOKENS_BASE = {
    "rsETH":  "0xC5DbB6F24F97e5Bc0cB0A48a0254D42070898b52",
    "wstETH": "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452",
    "cbETH":  "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
    "rETH":   "0xB6fe221Fe9EeF5aBa221c348bA20A1Bf5e73624c",
    "weETH":  "0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A",
}

# Ethereum L1
L1_CONTRACTS = {
    "rsETH": {
        "deposit_pool": "0x036676389e48133B63a802f8635AD39E752D375D",  # Kelp LRTDepositPool
    },
    "wstETH": {
        "steth": "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",        # Lido stETH
        "wsteth": "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",       # wstETH on L1
    },
    "cbETH": {
        "cbeth": "0xBe9895146f7AF43049ca1c1AE358B0541Ea49704",        # cbETH on L1
    },
    "rETH": {
        "reth": "0xae78736Cd615f374D3085123A210448E74Fc6393",         # Rocket Pool rETH L1
    },
    "weETH": {
        "liquidity_pool": "0x308861A430be4cce5502d0A12724771Fc6DaF216", # ether.fi LiquidityPool
        "eeth": "0x35fA164735182de50811E8e2E824cFb9B6118ac2",          # eETH on L1
    },
}

# Contagion peril IDs
CONTAGION_PERIL_IDS = {
    "rsETH":  "0x7ded8ed39b342f0fcc04c181f9b970f5f519fb15e537b23d5bdfe757a1a88ee1",
    "wstETH": "0xa19e1d09b34bf5c0241806ac0e07f1790cc2c05bd25272276e9b7d880fe65f77",
    "cbETH":  "0x6c653bbe7d4e6245c1730bc8a7d8f8da21b8b52f916c7a3f02a0062c0d18b883",
    "rETH":   "0x31e7681b6e365c4ec2b461baff8cea051e565365ad6381c234feb0ab497c6d33",
    "weETH":  "0xcaab67112643b3fcc68e249d891f71153179ea5d53c47a0a2f60183c72e4bd11",
}

# ── ABIs (minimal) ──

ERC20_TOTAL_SUPPLY_ABI = [{"type": "function", "name": "totalSupply", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint256"}]}]

KELP_DEPOSIT_POOL_ABI = [{"type": "function", "name": "getTotalAssetDeposits", "stateMutability": "view", "inputs": [{"name": "asset", "type": "address"}], "outputs": [{"type": "uint256"}]}]

STETH_ABI = [{"type": "function", "name": "getTotalPooledEther", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint256"}]}]

WSTETH_ABI = [{"type": "function", "name": "stEthPerToken", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint256"}]}]

CBETH_ABI = [{"type": "function", "name": "exchangeRate", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint256"}]}]

RETH_ABI = [
    {"type": "function", "name": "getExchangeRate", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint256"}]},
    {"type": "function", "name": "getTotalCollateral", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint256"}]},
]

EETH_ABI = [{"type": "function", "name": "totalSupply", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint256"}]}]

CONTAGION_TRIGGER_ABI = [
    {
        "type": "function",
        "name": "pushAndTrigger",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "assetId", "type": "bytes32"},
            {"name": "totalBacking", "type": "uint256"},
            {"name": "totalSupply", "type": "uint256"},
        ],
        "outputs": [{"name": "triggered", "type": "bool"}],
    },
]

# ETH address used for Kelp deposit queries
WETH_L1 = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
STETH_L1 = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84"


class BackingOracle:
    """Fetches backing ratios from L1 + Base, pushes to ContagionTrigger."""

    def __init__(self):
        self.enabled = False
        self.w3_base = None
        self.w3_l1 = None
        self.account = None
        self.trigger_contract = None

        rpc_base = os.environ.get("DSRPT_RPC_URL", "")
        rpc_l1 = os.environ.get("DSRPT_L1_RPC_URL", "")
        relayer_key = os.environ.get("DSRPT_RELAYER_KEY", "")

        if not rpc_base or not relayer_key:
            log.info("BackingOracle: missing DSRPT_RPC_URL or DSRPT_RELAYER_KEY — disabled")
            return

        if not rpc_l1:
            log.info("BackingOracle: missing DSRPT_L1_RPC_URL — L1 queries disabled, using fallback ratios")

        if not HAS_WEB3:
            log.warning("BackingOracle: web3 not installed — disabled")
            return

        try:
            self.w3_base = Web3(Web3.HTTPProvider(rpc_base, request_kwargs={"timeout": 30}))
            if rpc_l1:
                self.w3_l1 = Web3(Web3.HTTPProvider(rpc_l1, request_kwargs={"timeout": 30}))

            self.account = self.w3_base.eth.account.from_key(relayer_key)
            self.trigger_contract = self.w3_base.eth.contract(
                address=Web3.to_checksum_address(CONTAGION_TRIGGER),
                abi=CONTAGION_TRIGGER_ABI,
            )
            self.enabled = True
            log.info(f"BackingOracle: online (L1: {'connected' if self.w3_l1 else 'fallback mode'})")
        except Exception as e:
            log.error(f"BackingOracle init failed: {e}")

    def refresh_all(self):
        """Fetch backing ratios for all wrapped assets and push to chain."""
        if not self.enabled:
            return

        for symbol in CONTAGION_PERIL_IDS:
            try:
                backing, supply = self._fetch_ratio(symbol)
                if backing is None or supply is None:
                    log.warning(f"  [{symbol}] backing data unavailable — skipping")
                    continue

                triggered = self._push_ratio(symbol, backing, supply)
                ratio_pct = (backing * 100 / supply) if supply > 0 else 0
                status = "TRIGGERED" if triggered else "ok"
                print(f"  Backing [{symbol}]: R={ratio_pct:.2f}% backing={backing} supply={supply} [{status}]", flush=True)
            except Exception as e:
                log.warning(f"  [{symbol}] backing oracle error: {e}")

    def _fetch_ratio(self, symbol: str) -> tuple:
        """Returns (totalBacking, totalSupply) in 18-decimal wei."""

        # Get totalSupply on Base
        base_token = WRAPPED_TOKENS_BASE.get(symbol)
        if not base_token:
            return None, None

        token_contract = self.w3_base.eth.contract(
            address=Web3.to_checksum_address(base_token),
            abi=ERC20_TOTAL_SUPPLY_ABI,
        )
        total_supply = token_contract.functions.totalSupply().call()

        if total_supply == 0:
            return None, None

        # Get backing from L1 (or fallback)
        total_backing = self._fetch_l1_backing(symbol, total_supply)

        return total_backing, total_supply

    def _fetch_l1_backing(self, symbol: str, total_supply: int) -> int:
        """Fetch backing from L1. Falls back to 1:1 if L1 RPC not available."""

        if not self.w3_l1:
            # No L1 RPC — assume 1:1 backing (conservative)
            return total_supply

        try:
            if symbol == "rsETH":
                return self._fetch_rseth_backing()
            elif symbol == "wstETH":
                return self._fetch_wsteth_backing(total_supply)
            elif symbol == "cbETH":
                return self._fetch_cbeth_backing(total_supply)
            elif symbol == "rETH":
                return self._fetch_reth_backing(total_supply)
            elif symbol == "weETH":
                return self._fetch_weeth_backing(total_supply)
        except Exception as e:
            log.warning(f"  [{symbol}] L1 query failed: {e} — using 1:1 fallback")

        return total_supply  # fallback: assume fully backed

    def _fetch_rseth_backing(self) -> int:
        """Kelp rsETH: sum of ETH + stETH deposits in LRTDepositPool."""
        addr = L1_CONTRACTS["rsETH"]["deposit_pool"]
        pool = self.w3_l1.eth.contract(
            address=Web3.to_checksum_address(addr),
            abi=KELP_DEPOSIT_POOL_ABI,
        )
        # Query ETH deposits
        eth_deposits = pool.functions.getTotalAssetDeposits(
            Web3.to_checksum_address(WETH_L1)
        ).call()
        # Query stETH deposits
        steth_deposits = pool.functions.getTotalAssetDeposits(
            Web3.to_checksum_address(STETH_L1)
        ).call()
        return eth_deposits + steth_deposits

    def _fetch_wsteth_backing(self, base_supply: int) -> int:
        """Lido wstETH: backing = base_supply * stEthPerToken (exchange rate)."""
        addr = L1_CONTRACTS["wstETH"]["wsteth"]
        wsteth = self.w3_l1.eth.contract(
            address=Web3.to_checksum_address(addr),
            abi=WSTETH_ABI,
        )
        # stEthPerToken returns how much stETH 1 wstETH is worth (18 decimals)
        rate = wsteth.functions.stEthPerToken().call()
        # Backing = supply * rate / 1e18
        return (base_supply * rate) // (10 ** 18)

    def _fetch_cbeth_backing(self, base_supply: int) -> int:
        """Coinbase cbETH: backing = base_supply * exchangeRate."""
        addr = L1_CONTRACTS["cbETH"]["cbeth"]
        cbeth = self.w3_l1.eth.contract(
            address=Web3.to_checksum_address(addr),
            abi=CBETH_ABI,
        )
        rate = cbeth.functions.exchangeRate().call()
        return (base_supply * rate) // (10 ** 18)

    def _fetch_reth_backing(self, base_supply: int) -> int:
        """Rocket Pool rETH: backing = base_supply * exchangeRate.
        getTotalCollateral returns only contract balance (for withdrawals),
        not total staked ETH. Use exchange rate like other LSTs."""
        addr = L1_CONTRACTS["rETH"]["reth"]
        reth = self.w3_l1.eth.contract(
            address=Web3.to_checksum_address(addr),
            abi=RETH_ABI,
        )
        rate = reth.functions.getExchangeRate().call()
        return (base_supply * rate) // (10 ** 18)

    def _fetch_weeth_backing(self, base_supply: int) -> int:
        """ether.fi weETH: eETH totalSupply on L1 as proxy for backing."""
        addr = L1_CONTRACTS["weETH"]["eeth"]
        eeth = self.w3_l1.eth.contract(
            address=Web3.to_checksum_address(addr),
            abi=EETH_ABI,
        )
        return eeth.functions.totalSupply().call()

    def _push_ratio(self, symbol: str, total_backing: int, total_supply: int) -> bool:
        """Push ratio to ContagionTrigger.pushAndTrigger() on Base."""
        peril_id = CONTAGION_PERIL_IDS.get(symbol)
        if not peril_id:
            return False

        try:
            nonce = self.w3_base.eth.get_transaction_count(self.account.address, "pending")

            tx = self.trigger_contract.functions.pushAndTrigger(
                peril_id,
                total_backing,
                total_supply,
            ).build_transaction({
                "from": self.account.address,
                "nonce": nonce,
                "gas": 200_000,
                "maxFeePerGas": self.w3_base.eth.gas_price * 2,
                "maxPriorityFeePerGas": self.w3_base.to_wei(0.001, "gwei"),
                "chainId": self.w3_base.eth.chain_id,
            })

            signed = self.account.sign_transaction(tx)
            # web3.py v6 uses rawTransaction, v7 uses raw_transaction
            raw = getattr(signed, 'raw_transaction', None) or getattr(signed, 'rawTransaction', None)
            tx_hash = self.w3_base.eth.send_raw_transaction(raw)
            log.info(f"  [{symbol}] pushed ratio: tx={tx_hash.hex()}")

            # Check return value: true = breach triggered
            # We can't read return value from send, but the event will tell us
            return False
        except Exception as e:
            log.warning(f"  [{symbol}] push failed: {e}")
            return False
