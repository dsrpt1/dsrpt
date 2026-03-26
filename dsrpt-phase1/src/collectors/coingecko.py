"""
Dsrpt Phase 1 — Data Collector
Fetches historical OHLCV data from CoinGecko public API.
For production: swap in Kaiko / Amberdata for liquidity depth data.
"""

import requests
import pandas as pd
import time
import json
import os
from datetime import datetime, timezone

COINGECKO_BASE = "https://api.coingecko.com/api/v3"

COIN_IDS = {
    "UST":  "terrausd",
    "USDC": "usd-coin",
    "FRAX": "frax",
}

def fetch_market_chart(coin_id: str, start_date: str, end_date: str) -> pd.DataFrame:
    """
    Fetch hourly price + volume from CoinGecko for a date range.
    Returns DataFrame with columns: timestamp, price, volume
    """
    start_ts = int(datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp())
    end_ts   = int(datetime.strptime(end_date,   "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp())

    url = f"{COINGECKO_BASE}/coins/{coin_id}/market_chart/range"
    params = {
        "vs_currency": "usd",
        "from": start_ts,
        "to":   end_ts,
    }

    resp = requests.get(url, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    prices  = pd.DataFrame(data["prices"],        columns=["ts_ms", "price"])
    volumes = pd.DataFrame(data["total_volumes"],  columns=["ts_ms", "volume"])

    df = prices.merge(volumes, on="ts_ms")
    df["timestamp"] = pd.to_datetime(df["ts_ms"], unit="ms", utc=True)
    df = df.drop(columns=["ts_ms"]).sort_values("timestamp").reset_index(drop=True)
    return df


def fetch_event(event_key: str, event_cfg: dict, cache_dir: str = "data/raw") -> pd.DataFrame:
    """
    Fetch or load cached data for a single event.
    """
    os.makedirs(cache_dir, exist_ok=True)
    cache_path = os.path.join(cache_dir, f"{event_key}.parquet")

    if os.path.exists(cache_path):
        print(f"  [cache] Loading {event_key}")
        return pd.read_parquet(cache_path)

    coin = event_cfg["stablecoin"]
    coin_id = COIN_IDS.get(coin)
    if not coin_id:
        raise ValueError(f"No CoinGecko ID for {coin}")

    print(f"  [fetch] {event_key} ({event_cfg['start']} → {event_cfg['end']})")
    df = fetch_market_chart(coin_id, event_cfg["start"], event_cfg["end"])
    df.to_parquet(cache_path, index=False)
    time.sleep(1.5)   # CoinGecko rate limit
    return df


def fetch_all_events(events: dict, cache_dir: str = "data/raw") -> dict:
    """
    Fetch all configured events. Returns dict of DataFrames.
    """
    results = {}
    for key, cfg in events.items():
        try:
            results[key] = fetch_event(key, cfg, cache_dir)
            print(f"    → {len(results[key])} rows")
        except Exception as e:
            print(f"  [error] {key}: {e}")
    return results
