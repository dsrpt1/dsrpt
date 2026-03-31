"""
Dsrpt Terminal — Live Polling Loop

Runs continuously, polling price data every 15 minutes.
Feeds the window manager, runs the signal engine,
sends Telegram alerts on state changes.

Setup:
  1. Create a Telegram bot via @BotFather
  2. Get your chat_id by messaging @userinfobot
  3. Set environment variables:
       DSRPT_TELEGRAM_TOKEN=your_bot_token
       DSRPT_TELEGRAM_CHAT=your_chat_id
  4. Run: py runner.py

Or pass directly:
  py runner.py --token YOUR_TOKEN --chat YOUR_CHAT_ID

Assets monitored by default:
  USDC, USDT, DAI, FRAX
"""

import os
import sys
import time
import argparse

print("[boot] starting imports...", flush=True)

import requests
import pandas as pd
from datetime import datetime, timezone, timedelta

print("[boot] stdlib + pandas ok", flush=True)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from terminal.src.window_manager  import WindowManager, Tick
from terminal.src.feature_engine  import run_feature_engine
from terminal.src.signal_engine   import SignalEngine, format_signal
from terminal.src.telegram_format import (
    AlertState, format_telegram, format_plain,
    confidence_to_level, REGIME_TO_LEVEL
)

print("[boot] signal engine ok", flush=True)

from terminal.src.chain_relay import ChainRelay

print("[boot] chain_relay ok", flush=True)

from terminal.src.db import SignalDB

print("[boot] db ok", flush=True)


# ─────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────

POLL_INTERVAL_SECONDS = 900    # 15 minutes
WINDOW_HOURS          = 48
WARMUP_HOURS          = 4

ASSETS = {
    "USDC": {"binance": "USDCUSDT", "kraken": "USDCUSD", "coingecko": "usd-coin"},
    "USDT": {"binance": "USDTUSDC", "kraken": "USDTUSD", "coingecko": "tether"},
    "DAI":  {"binance": "DAIUSDT",  "kraken": "DAIUSD",  "coingecko": "dai"},
    "FRAX": {"binance": "FRAXUSDT", "kraken": "FRAXUSD",  "coingecko": "frax"},
}


# ─────────────────────────────────────────────
# Price fetchers
# ─────────────────────────────────────────────

def fetch_binance(symbol: str) -> dict | None:
    """Fetch latest 1h candle from Binance."""
    try:
        url = "https://api.binance.com/api/v3/klines"
        params = {"symbol": symbol, "interval": "15m", "limit": 2}
        resp = requests.get(url, params=params, timeout=10)
        if resp.status_code != 200:
            return None
        data = resp.json()
        if not data:
            return None
        candle = data[-2]   # last completed candle
        return {
            "price":  float(candle[4]),    # close
            "volume": float(candle[7]),    # quote volume
        }
    except Exception:
        return None


def fetch_kraken(pair: str) -> dict | None:
    """Fetch latest tick from Kraken."""
    try:
        url = "https://api.kraken.com/0/public/Ticker"
        resp = requests.get(url, params={"pair": pair}, timeout=10)
        if resp.status_code != 200:
            return None
        data = resp.json()
        if data.get("error"):
            return None
        result = data["result"]
        pair_key = list(result.keys())[0]
        ticker = result[pair_key]
        price  = float(ticker["c"][0])   # last trade price
        volume = float(ticker["v"][1])   # 24h volume
        return {"price": price, "volume": volume}
    except Exception:
        return None


def fetch_price(asset: str) -> dict | None:
    """Try Binance first, fall back to Kraken."""
    cfg    = ASSETS.get(asset, {})
    result = None

    if cfg.get("binance"):
        result = fetch_binance(cfg["binance"])
    if result is None and cfg.get("kraken"):
        result = fetch_kraken(cfg["kraken"])

    if result:
        result["asset"]     = asset
        result["timestamp"] = datetime.now(tz=timezone.utc)
        result["source"]    = "live"

    return result


# ─────────────────────────────────────────────
# Telegram sender
# ─────────────────────────────────────────────

def send_telegram(message: str, token: str, chat_id: str) -> bool:
    """Send a message via Telegram Bot API."""
    try:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = {
            "chat_id":    chat_id,
            "text":       message,
            "parse_mode": "MarkdownV2",
            "disable_web_page_preview": True,
        }
        resp = requests.post(url, json=payload, timeout=10)
        if resp.status_code == 200:
            return True
        # Fallback: send as plain text if markdown fails
        payload["parse_mode"] = None
        payload["text"] = message.replace("\\", "").replace("*", "").replace("`", "")
        resp = requests.post(url, json=payload, timeout=10)
        return resp.status_code == 200
    except Exception as e:
        print(f"  Telegram send error: {e}")
        return False


def send_startup_message(token: str, chat_id: str, assets: list):
    """Send a startup notification."""
    asset_list = ", ".join(assets)
    msg = (
        f"🟢 *DSRPT TERMINAL ONLINE*\n\n"
        f"Monitoring: `{asset_list}`\n"
        f"Poll interval: 15 minutes\n"
        f"Window: 48h lookback\n\n"
        f"_Alerts fire on regime transitions only\\._"
    )
    send_telegram(msg, token, chat_id)


# ─────────────────────────────────────────────
# Per-asset state
# ─────────────────────────────────────────────

class AssetMonitor:
    def __init__(self, asset: str, token: str, chat_id: str, chain_relay: ChainRelay = None, db: SignalDB = None):
        self.asset     = asset
        self.token     = token
        self.chat_id   = chat_id
        self.chain_relay = chain_relay
        self.db        = db
        self.window    = WindowManager(max_hours=WINDOW_HOURS, min_hours=WARMUP_HOURS)
        self.engine    = SignalEngine(asset=asset)
        self.prev_regime = None
        self.tick_count  = 0

    def process_tick(self, price: float, volume: float, timestamp: datetime):
        self.tick_count += 1
        self.window.insert(Tick(timestamp=timestamp, price=price, volume=volume))

        if not self.window.is_ready():
            print(f"  [{self.asset}] warming up ({self.window.span_hours:.1f}h / {WARMUP_HOURS}h)")
            return

        window_df = self.window.to_dataframe()
        try:
            result = run_feature_engine(window_df, self.asset)
        except Exception as e:
            print(f"  [{self.asset}] feature engine error: {e}")
            return

        sig = self.engine.process(timestamp, result)

        # Log every tick
        regime = result["regime"]
        scores = result["partial_scores"]
        top    = max(scores, key=scores.get)
        print(f"  [{self.asset}] {timestamp.strftime('%H:%M')}  "
              f"${price:.4f}  "
              f"regime={regime:<22}  "
              f"{top}:{scores[top]:.2f}")

        # Persist tick to database
        if self.db:
            conf = scores.get(regime, 0.5) if regime != "ambiguous" else 0.3
            self.db.write_tick(
                asset=self.asset,
                ts=timestamp,
                price=price,
                volume=volume,
                regime=regime,
                confidence=conf,
                max_severity=result.get("max_severity", 0),
                partial_scores=scores,
            )

        # Send alert if signal emitted
        if sig and sig.signal_type in ("TRANSITION", "COLDSTART", "WARNING"):
            self._send_alert(sig, result)
            self.prev_regime = regime

    def _send_alert(self, sig, result):
        """Format and send the alert."""
        partial = result["partial_scores"]
        regime  = sig.regime
        conf    = partial.get(regime, 0.5) if regime != "ambiguous" else 0.3
        level   = confidence_to_level(regime, conf, sig.prev_regime)

        # Tail risk from curve family
        from src.scoring.curve_families import get_regime_prior_families
        priors = get_regime_prior_families(regime)
        fn     = list(priors.values())[0] if priors else (lambda x: 0.5)

        alert = AlertState(
            level       = level,
            asset       = self.asset,
            timestamp   = sig.timestamp,
            price       = sig.current_price,
            regime      = regime,
            confidence  = conf,
            tail_3pct   = round(fn(0.03) * 100, 1),
            tail_10pct  = round(fn(0.10) * 100, 1),
            notes       = sig.notes[:120] if sig.notes else "",
        )

        plain_msg = format_plain(alert)
        print(f"\n{plain_msg}\n")

        if self.token and self.chat_id:
            tg_msg  = format_telegram(alert)
            success = send_telegram(tg_msg, self.token, self.chat_id)
            status  = "sent" if success else "failed"
            print(f"  Telegram: {status}")
        else:
            print("  (Telegram not configured — console only)")

        # On-chain relay: submit regime update to OracleAdapter
        tx_hash = None
        if self.chain_relay:
            tx_hash = self.chain_relay.relay(
                asset=self.asset,
                regime=regime,
                confidence=conf,
                current_price=sig.current_price,
                max_severity=sig.max_severity,
            )
            if tx_hash:
                print(f"  Chain relay: tx {tx_hash}")
            else:
                print("  Chain relay: skipped or failed")

        # Persist alert to database
        if self.db:
            self.db.write_alert(
                asset=self.asset,
                ts=sig.timestamp,
                signal_type=sig.signal_type,
                regime=regime,
                prev_regime=sig.prev_regime,
                confidence=conf,
                price=sig.current_price,
                max_severity=sig.max_severity,
                rule_fired=sig.rule_fired,
                notes=sig.notes[:500] if sig.notes else "",
                tx_hash=tx_hash,
            )


# ─────────────────────────────────────────────
# Main loop
# ─────────────────────────────────────────────

def run(assets: list, token: str = "", chat_id: str = "", interval: int = POLL_INTERVAL_SECONDS):
    # Initialize chain relay and database (no-op if env vars missing)
    relay = ChainRelay()
    db = SignalDB()

    print("\n" + "="*56, flush=True)
    print("DSRPT TERMINAL — LIVE MONITOR", flush=True)
    print(f"Assets: {', '.join(assets)}", flush=True)
    print(f"Poll: every {interval//60} minutes", flush=True)
    print(f"Telegram: {'configured' if token else 'not configured (console only)'}", flush=True)
    print(f"Chain relay: {'online' if relay.enabled else 'not configured'}", flush=True)
    print(f"Database: {'connected' if db.enabled else 'not configured'}", flush=True)
    print(f"DATABASE_URL set: {bool(os.environ.get('DATABASE_URL', ''))}", flush=True)
    print("="*56 + "\n", flush=True)

    if token and chat_id:
        send_startup_message(token, chat_id, assets)

    monitors = {asset: AssetMonitor(asset, token, chat_id, chain_relay=relay, db=db) for asset in assets}
    fail_counts = {asset: 0 for asset in assets}

    while True:
        tick_start = datetime.now(tz=timezone.utc)
        print(f"\n[{tick_start.strftime('%Y-%m-%d %H:%M UTC')}] Polling...")

        for asset in assets:
            data = fetch_price(asset)
            if data is None:
                fail_counts[asset] += 1
                print(f"  [{asset}] fetch failed (consecutive: {fail_counts[asset]})")
                if fail_counts[asset] >= 5 and token:
                    send_telegram(
                        f"⚠️ DSRPT: {asset} data feed failed {fail_counts[asset]} times",
                        token, chat_id
                    )
                continue

            fail_counts[asset] = 0
            monitors[asset].process_tick(
                price     = data["price"],
                volume    = data["volume"],
                timestamp = data["timestamp"],
            )

        # Sleep until next poll
        elapsed = (datetime.now(tz=timezone.utc) - tick_start).total_seconds()
        sleep_s = max(0, interval - elapsed)
        print(f"\nNext poll in {sleep_s:.0f}s  (Ctrl+C to stop)")
        time.sleep(sleep_s)


# ─────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Dsrpt Terminal — Live Monitor")
    parser.add_argument("--assets", nargs="+", default=["USDC", "USDT", "DAI", "FRAX"],
                        help="Assets to monitor")
    parser.add_argument("--token",  default=os.environ.get("DSRPT_TELEGRAM_TOKEN", ""),
                        help="Telegram bot token")
    parser.add_argument("--chat",   default=os.environ.get("DSRPT_TELEGRAM_CHAT", ""),
                        help="Telegram chat ID")
    parser.add_argument("--interval", type=int, default=POLL_INTERVAL_SECONDS,
                        help="Poll interval in seconds (default: 900)")
    args = parser.parse_args()

    try:
        run(args.assets, args.token, args.chat, interval=args.interval)
    except KeyboardInterrupt:
        print("\n\nDsrpt Terminal stopped.")


if __name__ == "__main__":
    main()
