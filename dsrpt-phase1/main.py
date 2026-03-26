"""
Dsrpt Phase 1 — Main Pipeline Runner

Run: python main.py

Output:
  - data/processed/{EVENT_KEY}_enriched.parquet
  - data/processed/{EVENT_KEY}_rl_curve.csv
  - output/charts/{EVENT_KEY}_severity.png
  - output/charts/{EVENT_KEY}_rl_vs_curves.png
  - output/charts/ranking_summary.png
"""

import os
import sys
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec

# Add project root to path
sys.path.insert(0, os.path.dirname(__file__))

from src.config import EVENTS, ATTACHMENT_LEVELS, LAMBDA_TAIL
from src.collectors.coingecko import fetch_all_events
from src.pipeline.rl_surface import build_realized_loss_surface
from src.scoring.score import CURVES, rank_curves, score_curve

COLORS = {
    "flat":        "#888888",
    "steep":       "#e74c3c",
    "convex":      "#3498db",
    "power_law":   "#2ecc71",
}
RL_COLOR    = "#f39c12"
DSRPT_COLOR = "#8e44ad"


# ─────────────────────────────────────────────
# Chart 1: Severity Time Series
# ─────────────────────────────────────────────

def plot_severity(df: pd.DataFrame, event_key: str, event_cfg: dict, out_dir: str):
    fig, axes = plt.subplots(3, 1, figsize=(12, 8), sharex=True)
    fig.suptitle(f"{event_cfg['name']} — Depeg Severity Decomposition", fontsize=13, fontweight="bold")

    axes[0].plot(df["timestamp"], df["price"], color="#2c3e50", linewidth=1.2)
    axes[0].axhline(1.0, color="gray", linestyle="--", linewidth=0.8)
    axes[0].set_ylabel("Price (USD)")
    axes[0].set_title("Price vs Peg", fontsize=10)
    axes[0].set_ylim(max(0, df["price"].min() * 0.95), 1.02)

    axes[1].fill_between(df["timestamp"], df["severity"], alpha=0.6, color="#e74c3c")
    axes[1].set_ylabel("I(t)")
    axes[1].set_title("Raw Depeg Severity", fontsize=10)

    axes[2].fill_between(df["timestamp"], df["adjusted_severity"], alpha=0.6, color=RL_COLOR)
    axes[2].set_ylabel("I*(t)")
    axes[2].set_title("Liquidity-Adjusted Severity", fontsize=10)

    plt.tight_layout()
    path = os.path.join(out_dir, f"{event_key}_severity.png")
    plt.savefig(path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  → {path}")


# ─────────────────────────────────────────────
# Chart 2: RL Curve vs Candidate Models
# ─────────────────────────────────────────────

def plot_rl_vs_curves(rl_curve: pd.DataFrame, event_key: str, event_cfg: dict, out_dir: str):
    x = np.array(ATTACHMENT_LEVELS)

    fig, axes = plt.subplots(1, 2, figsize=(14, 6))
    fig.suptitle(f"{event_cfg['name']} — Realized Loss vs Predicted Curves", fontsize=13, fontweight="bold")

    ax = axes[0]
    ax.plot(rl_curve["attachment"], rl_curve["rl_prob"],
            color=RL_COLOR, linewidth=2.5, marker="o", markersize=5, label="RL(x) Realized", zorder=5)

    for name, fn in CURVES.items():
        el_vals = [fn(xi) for xi in x]
        ax.plot(x, el_vals, color=COLORS[name], linewidth=1.5, linestyle="--", label=name, alpha=0.8)

    ax.set_xlabel("Attachment Level (x)")
    ax.set_ylabel("Probability")
    ax.set_title("Curves vs Realized Loss")
    ax.legend(fontsize=8)
    ax.set_xlim(0, max(ATTACHMENT_LEVELS) * 1.05)
    ax.set_ylim(-0.05, 1.05)
    ax.grid(alpha=0.3)

    # Weighted error area per model
    ax2 = axes[1]
    rankings = rank_curves(CURVES, rl_curve, event_key)
    bars = ax2.barh(rankings["model"], -rankings["score"],   # negate: lower error = better
                    color=[COLORS.get(m, DSRPT_COLOR) for m in rankings["model"]])
    ax2.set_xlabel("Weighted Integral Error (lower = better)")
    ax2.set_title("Model Ranking")
    ax2.invert_xaxis()

    for bar, (_, row) in zip(bars, rankings.iterrows()):
        ax2.text(bar.get_width() + 0.0001, bar.get_y() + bar.get_height()/2,
                 f"score: {row['score']:.5f}", va="center", fontsize=8)

    plt.tight_layout()
    path = os.path.join(out_dir, f"{event_key}_rl_vs_curves.png")
    plt.savefig(path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  → {path}")

    return rankings


# ─────────────────────────────────────────────
# Chart 3: Cross-Event Ranking Summary
# ─────────────────────────────────────────────

def plot_ranking_summary(all_rankings: dict, out_dir: str):
    events = list(all_rankings.keys())
    models = list(CURVES.keys())

    fig, axes = plt.subplots(1, len(events), figsize=(5 * len(events), 5), sharey=True)
    if len(events) == 1:
        axes = [axes]

    fig.suptitle("Cross-Event Model Ranking\n(Score: higher = better fit to realized loss)",
                 fontsize=13, fontweight="bold")

    for ax, event_key in zip(axes, events):
        df = all_rankings[event_key]
        colors = [COLORS.get(m, DSRPT_COLOR) for m in df["model"]]
        bars = ax.barh(df["model"], df["score"], color=colors)
        ax.set_title(EVENTS[event_key]["name"], fontsize=10)
        ax.set_xlabel("Score")
        ax.grid(axis="x", alpha=0.3)

        for bar, (_, row) in zip(bars, df.iterrows()):
            ax.text(bar.get_width() + abs(df["score"].max()) * 0.02,
                    bar.get_y() + bar.get_height()/2,
                    f"#{int(df[df['model']==row['model']].index[0])+1}",
                    va="center", fontsize=9, fontweight="bold")

    plt.tight_layout()
    path = os.path.join(out_dir, "ranking_summary.png")
    plt.savefig(path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  → {path}")


# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────

def main():
    print("\n=== Dsrpt Phase 1: Realized Loss Surface Pipeline ===\n")

    os.makedirs("data/raw",       exist_ok=True)
    os.makedirs("data/processed", exist_ok=True)
    os.makedirs("output/charts",  exist_ok=True)

    # 1. Fetch data
    print("[1/4] Fetching historical data...")
    raw_data = fetch_all_events(EVENTS, cache_dir="data/raw")

    if not raw_data:
        print("ERROR: No data fetched. Check network or API limits.")
        return

    # 2. Build RL surfaces
    print("\n[2/4] Building realized loss surfaces...")
    rl_surfaces = {}
    enriched    = {}

    for event_key, cfg in EVENTS.items():
        if event_key not in raw_data:
            print(f"  [skip] {event_key} — no data")
            continue
        print(f"  Processing {event_key}...")
        df, rl = build_realized_loss_surface(raw_data[event_key], cfg)
        enriched[event_key]   = df
        rl_surfaces[event_key] = rl

        # Save processed data
        df.to_parquet(f"data/processed/{event_key}_enriched.parquet", index=False)
        rl.to_csv(f"data/processed/{event_key}_rl_curve.csv", index=False)
        print(f"    RL peak: {rl['rl_prob'].max():.4f} at x={rl.loc[rl['rl_prob'].idxmax(), 'attachment']:.3f}")

    # 3. Score and rank
    print("\n[3/4] Scoring curves...")
    all_rankings = {}

    for event_key in rl_surfaces:
        cfg = EVENTS[event_key]
        print(f"\n  {cfg['name']}:")
        rankings = rank_curves(CURVES, rl_surfaces[event_key], event_key)
        all_rankings[event_key] = rankings
        print(rankings[["model", "score", "mse_unweighted"]].to_string(index=False))

    # 4. Charts
    print("\n[4/4] Generating charts...")
    for event_key in rl_surfaces:
        cfg = EVENTS[event_key]
        plot_severity(enriched[event_key], event_key, cfg, "output/charts")
        plot_rl_vs_curves(rl_surfaces[event_key], event_key, cfg, "output/charts")

    if len(all_rankings) > 0:
        plot_ranking_summary(all_rankings, "output/charts")

    print("\n=== Phase 1 Complete ===")
    print("Next step: Review ranking_summary.png")
    print("  → If rankings are stable across all 3 events, scoring function is valid.")
    print("  → If rankings flip between events, λ needs recalibration or RL construction needs review.")


if __name__ == "__main__":
    main()
