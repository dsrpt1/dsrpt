"""
Dsrpt Terminal — Replay Engine

Simulates the live polling loop on historical data.

Critical integrity guarantee:
  At each simulated tick T, ONLY data with timestamp <= T
  is in the window. This is enforced by WindowManager.insert()
  which rejects out-of-order ticks.

This means the replay produces EXACTLY what a live system
would have produced — no hindsight, no smoothing.

The output answers: "Here's when the system knew."

Usage:
  python replay.py --event UST_2022
  python replay.py --event USDC_2023
  python replay.py --event all
"""

import sys
import os
import argparse
import pandas as pd
import numpy as np
from datetime import timezone
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from terminal.src.window_manager import WindowManager, Tick
from terminal.src.feature_engine import run_feature_engine
from terminal.src.signal_engine  import SignalEngine, format_signal

from src.config import EVENTS


# ─────────────────────────────────────────────
# Replay configuration
# ─────────────────────────────────────────────

REPLAY_CONFIG = {
    "tick_interval_hours": 1,    # simulate one tick per hour (matches data resolution)
    "window_hours":        48,   # rolling 48h lookback
    "warmup_hours":        4,    # minimum hours before first classification
}

EVENT_META = {
    "UST_2022": {
        "asset":         "UST/USD",
        "data_path":     "data/raw/UST_2022.parquet",
        "expected_flip": "reflexive_collapse",
        "lp_context":    "Curve 3pool UST LP — at risk of total loss",
    },
    "USDC_2023": {
        "asset":         "USDC/USD",
        "data_path":     "data/raw/USDC_2023.parquet",
        "expected_flip": "collateral_shock",
        "lp_context":    "Curve 3pool USDC LP — at risk of impermanent loss",
    },
    "FRAX_2023": {
        "asset":         "FRAX/USD",
        "data_path":     "data/raw/FRAX_2023.parquet",
        "expected_flip": "collateral_shock",
        "lp_context":    "Curve FRAX LP — contagion exposure",
    },
}


# ─────────────────────────────────────────────
# Core replay loop
# ─────────────────────────────────────────────

def replay_event(event_key: str, verbose: bool = False) -> dict:
    """
    Replay one event through the full signal pipeline.
    Returns summary dict with first signal timestamp and all signals emitted.
    """
    meta = EVENT_META[event_key]
    cfg  = EVENTS[event_key]

    print(f"\n{'='*60}")
    print(f"REPLAY: {event_key}  |  {meta['asset']}")
    print(f"Context: {meta['lp_context']}")
    print(f"{'='*60}")

    # Load data
    if not os.path.exists(meta["data_path"]):
        print(f"  ERROR: {meta['data_path']} not found. Run harness first.")
        return {}

    df = pd.read_parquet(meta["data_path"])
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df = df.sort_values("timestamp").reset_index(drop=True)

    print(f"Loaded {len(df)} ticks: {df.timestamp.iloc[0]} → {df.timestamp.iloc[-1]}")
    print(f"Price range: [{df.price.min():.4f}, {df.price.max():.4f}]")
    print(f"Simulating {REPLAY_CONFIG['tick_interval_hours']}h tick interval, "
          f"{REPLAY_CONFIG['window_hours']}h window, "
          f"{REPLAY_CONFIG['warmup_hours']}h warmup\n")

    window  = WindowManager(
        max_hours = REPLAY_CONFIG["window_hours"],
        min_hours = REPLAY_CONFIG["warmup_hours"],
    )
    engine  = SignalEngine(asset=meta["asset"])
    signals = []
    tick_log = []

    # ── Main replay loop ─────────────────────────────────────────
    for _, row in df.iterrows():
        ts = row["timestamp"].to_pydatetime()

        # Insert tick — WindowManager enforces no-lookahead
        window.insert(Tick(
            timestamp = ts,
            price     = float(row["price"]),
            volume    = float(row["volume"]),
        ))

        if not window.is_ready():
            if verbose:
                print(f"  {ts.strftime('%m-%d %H:%M')}  warming up ({window.span_hours:.1f}h / {REPLAY_CONFIG['warmup_hours']}h)")
            continue

        # Run feature engine on current window only
        window_df = window.to_dataframe()
        try:
            result = run_feature_engine(window_df, event_key)
        except Exception as e:
            if verbose:
                print(f"  {ts.strftime('%m-%d %H:%M')}  feature engine error: {e}")
            continue

        # Process signal
        sig = engine.process(ts, result)

        tick_log.append({
            "timestamp":           ts,
            "price":               float(row["price"]),
            "regime":              result["regime"],
            "rc_confidence":       result["partial_scores"].get("reflexive_collapse", 0),
            "cs_confidence":       result["partial_scores"].get("collateral_shock", 0),
            "ct_confidence":       result["partial_scores"].get("contained_stress", 0),
            "max_severity":        result["max_severity"],
            "abandonment_signal":  result["abandonment"],
            "signal_emitted":      sig is not None,
        })

        if sig:
            signals.append(sig)
            print(format_signal(sig))

        elif verbose:
            scores = result["partial_scores"]
            top = max(scores, key=scores.get)
            print(f"  {ts.strftime('%m-%d %H:%M')}  "
                  f"price={row['price']:.4f}  "
                  f"regime={result['regime']:<22}  "
                  f"top_partial={top}:{scores[top]:.2f}")

    # ── Summary ──────────────────────────────────────────────────
    print(f"\n{'─'*60}")
    print(f"REPLAY SUMMARY: {event_key}")
    print(f"{'─'*60}")
    print(f"Total ticks processed: {len(tick_log)}")
    print(f"Signals emitted: {len(signals)}")

    if signals:
        first_sig = signals[0]
        first_transition = next((s for s in signals if s.signal_type == "TRANSITION"), None)

        print(f"\nFirst signal:     {first_sig.timestamp.strftime('%Y-%m-%d %H:%M UTC')}  [{first_sig.signal_type}]  {first_sig.regime}")
        if first_transition:
            print(f"First transition: {first_transition.timestamp.strftime('%Y-%m-%d %H:%M UTC')}  {first_transition.prev_regime} → {first_transition.regime}")

            # How early vs price peak loss?
            if event_key in ["UST_2022"]:
                # UST peak loss around May 9 12:00 UTC (LFG intervention fails)
                pivot = pd.Timestamp("2022-05-09 12:00:00", tz="UTC")
            elif event_key in ["USDC_2023", "FRAX_2023"]:
                # USDC/FRAX trough around March 11 2023
                pivot = pd.Timestamp("2023-03-11 06:00:00", tz="UTC")
            else:
                pivot = None

            if pivot:
                first_ts = pd.Timestamp(first_transition.timestamp)
                delta = (pivot - first_ts).total_seconds() / 3600
                print(f"Signal lead time: {delta:.1f}h before price trough")
                if delta > 0:
                    print(f"  → LP had {delta:.1f} hours to act before worst losses")
                else:
                    print(f"  → Signal fired {abs(delta):.1f}h after trough (lagging — investigate)")

    # Save tick log
    os.makedirs("output/replay", exist_ok=True)
    log_df = pd.DataFrame(tick_log)
    log_df.to_csv(f"output/replay/{event_key}_tick_log.csv", index=False)
    print(f"\nTick log saved: output/replay/{event_key}_tick_log.csv")

    return {
        "event_key": event_key,
        "signals":   signals,
        "tick_log":  log_df,
        "n_signals": len(signals),
    }


# ─────────────────────────────────────────────
# Chart: confidence over time
# ─────────────────────────────────────────────

def chart_confidence_timeline(results: dict):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.dates as mdates

    events_with_data = {k: v for k, v in results.items() if v and "tick_log" in v and len(v["tick_log"]) > 0}
    if not events_with_data:
        return

    fig, axes = plt.subplots(len(events_with_data), 1,
                             figsize=(14, 5 * len(events_with_data)))
    if len(events_with_data) == 1:
        axes = [axes]

    fig.suptitle("Dsrpt Terminal — Regime Confidence Over Time\n"
                 "Shaded regions = signal emitted",
                 fontsize=13, fontweight="bold")

    regime_colors = {
        "reflexive_collapse":    "#e74c3c",
        "collateral_shock":      "#3498db",
        "contained_stress":      "#2ecc71",
        "ambiguous":             "#95a5a6",
    }

    for ax, (ek, result) in zip(axes, events_with_data.items()):
        log = result["tick_log"]
        log["timestamp"] = pd.to_datetime(log["timestamp"])

        # Price (right axis)
        ax2 = ax.twinx()
        ax2.plot(log["timestamp"], log["price"], color="#2c3e50",
                 linewidth=1.0, alpha=0.4, label="Price")
        ax2.set_ylabel("Price", fontsize=8)
        ax2.tick_params(axis="y", labelsize=7)

        # Confidence lines
        for col, regime, color in [
            ("rc_confidence", "reflexive_collapse", "#e74c3c"),
            ("cs_confidence", "collateral_shock",   "#3498db"),
            ("ct_confidence", "contained_stress",   "#2ecc71"),
        ]:
            if col in log.columns:
                ax.plot(log["timestamp"], log[col], color=color,
                        linewidth=1.5, label=regime, alpha=0.85)

        # Signal markers
        sig_rows = log[log["signal_emitted"]]
        if len(sig_rows) > 0:
            ax.scatter(sig_rows["timestamp"], [0.5] * len(sig_rows),
                       s=100, color="#f39c12", zorder=5, label="Signal emitted", marker="^")

        ax.axhline(0.45, color="gray", linestyle=":", linewidth=0.8, alpha=0.6)
        ax.set_ylim(-0.05, 1.05)
        ax.set_ylabel("Regime Confidence")
        ax.set_title(f"{ek}  |  {EVENT_META[ek]['asset']}", fontsize=10, fontweight="bold")
        ax.legend(fontsize=7, loc="upper left")
        ax.grid(alpha=0.2)
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%m-%d %H:%M"))
        ax.tick_params(axis="x", labelrotation=30, labelsize=7)

    plt.tight_layout()
    os.makedirs("output/replay", exist_ok=True)
    path = "output/replay/confidence_timeline.png"
    plt.savefig(path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"\nChart saved: {path}")


# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Dsrpt Terminal Replay Engine")
    parser.add_argument("--event",   default="all",
                        choices=["UST_2022", "USDC_2023", "FRAX_2023", "all"])
    parser.add_argument("--verbose", action="store_true",
                        help="Print every tick, not just signals")
    args = parser.parse_args()

    events = list(EVENT_META.keys()) if args.event == "all" else [args.event]

    print("\n" + "="*60)
    print("DSRPT TERMINAL — REPLAY ENGINE")
    print("Proving the signal fires in time.")
    print("="*60)

    results = {}
    for ek in events:
        results[ek] = replay_event(ek, verbose=args.verbose)

    chart_confidence_timeline(results)

    print("\n" + "="*60)
    print("REPLAY COMPLETE")
    print("\nKey question answered:")
    print("  → Check 'Signal lead time' above.")
    print("  → Positive = system knew before worst losses.")
    print("  → That is your product demo.")
    print("="*60)


if __name__ == "__main__":
    main()
