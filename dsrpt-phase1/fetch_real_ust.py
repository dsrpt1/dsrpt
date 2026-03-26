#!/usr/bin/env python3
"""
Real UST data fetch — run this locally after sandbox session.
Requires: pip install requests pandas pyarrow

CoinGecko free tier: 50 calls/min, no API key required.
UST (TerraUSD) CoinGecko ID: "terrausd"

Note: CoinGecko may have gaps in UST data post-collapse.
Fallback sources if CoinGecko is incomplete:
  - Messari: https://messari.io/asset/terrausd/metrics/price
  - The Graph / Terra subgraph (on-chain, most accurate)
  - Kaiko historical tick data (institutional, paid)
"""

import requests
import pandas as pd
from datetime import datetime, timezone
import os

def fetch_ust_real(output_path="data/raw/UST_2022_real.parquet"):
    coin_id = "terrausd"
    start_ts = int(datetime(2022, 5, 7, tzinfo=timezone.utc).timestamp())
    end_ts   = int(datetime(2022, 5, 14, tzinfo=timezone.utc).timestamp())

    url = f"https://api.coingecko.com/api/v3/coins/{coin_id}/market_chart/range"
    params = {"vs_currency": "usd", "from": start_ts, "to": end_ts}

    print(f"Fetching UST from CoinGecko ({start_ts} to {end_ts})...")
    resp = requests.get(url, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    prices  = pd.DataFrame(data["prices"],       columns=["ts_ms", "price"])
    volumes = pd.DataFrame(data["total_volumes"], columns=["ts_ms", "volume"])

    df = prices.merge(volumes, on="ts_ms")
    df["timestamp"] = pd.to_datetime(df["ts_ms"], unit="ms", utc=True)
    df["source"]    = "coingecko_real"
    df = df.drop(columns=["ts_ms"]).sort_values("timestamp").reset_index(drop=True)

    print(f"  Rows: {len(df)}")
    print(f"  Price range: [{df.price.min():.4f}, {df.price.max():.4f}]")
    print(f"  Date range: {df.timestamp.min()} to {df.timestamp.max()}")

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    df.to_parquet(output_path, index=False)
    print(f"  Saved to {output_path}")
    return df


if __name__ == "__main__":
    df = fetch_ust_real()
    print("\nNext step: replace UST_2022 cache with real data and rerun harness_v2_1.py")
    print("  cp data/raw/UST_2022_real.parquet data/raw/UST_2022.parquet")
    print("  python harness_v2_1.py")
