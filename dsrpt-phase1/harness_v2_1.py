"""
Dsrpt Experiment Harness v2.1

New in v2.1:
  - Soft prior selection policy
  - Three-way comparison: naive vs hard_prior vs soft_prior
  - Regret as primary evaluation metric
  - lambda_prior sensitivity sweep
  - Ambiguity as operational risk state (not classifier failure)

Central question:
  Does soft conditioning beat naive without the brittleness of hard conditioning?
"""

import os
import sys
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from src.config import EVENTS, LAMBDA_TAIL
from src.collectors.coingecko import fetch_all_events
from src.pipeline.rl_surface import build_realized_loss_surface
from src.scoring.curve_families import get_all_families
from src.scoring.soft_prior import (
    three_way_comparison, sweep_lambda_prior,
    LAMBDA_PRIOR_SWEEP, get_family
)
from src.regime.classifier_v2 import classify_event, features_to_df

OUT_DIR   = "output/harness_v2_1"
CHART_DIR = os.path.join(OUT_DIR, "charts")
GRID      = "medium"
LAMBDA_PRIOR_DEFAULT = 0.10


# ─────────────────────────────────────────────
# Chart 1: Three-Way Regret Comparison
# ─────────────────────────────────────────────

def chart_three_way_regret(comparison_df: pd.DataFrame, summary: dict):
    events  = comparison_df["event"].tolist()
    n       = len(events)
    x       = np.arange(n)
    w       = 0.25

    fig, axes = plt.subplots(1, 2, figsize=(14, 5))
    fig.suptitle("Three-Way Selection Policy Comparison\nMetric: Regret vs Oracle Best  (lower = better)",
                 fontsize=12, fontweight="bold")

    ax = axes[0]
    ax.bar(x - w,     comparison_df["naive_regret"].abs(), w, label="Naive",      color="#95a5a6", alpha=0.85)
    ax.bar(x,         comparison_df["hard_regret"].abs(),  w, label="Hard Prior", color="#e74c3c", alpha=0.85)
    ax.bar(x + w,     comparison_df["soft_regret"].abs(),  w, label="Soft Prior", color="#8e44ad", alpha=0.85)
    ax.set_xticks(x)
    ax.set_xticklabels(
        [f"{e}\n[{comparison_df.loc[i,'regime']}]" for i, e in enumerate(events)],
        fontsize=8
    )
    ax.set_ylabel("Regret (|oracle_score - selected_score|)")
    ax.set_title("Per-Event Regret")
    ax.legend(fontsize=9)
    ax.grid(axis="y", alpha=0.3)

    # Annotate winner per event
    for i, (_, row) in enumerate(comparison_df.iterrows()):
        best = row["best_policy"]
        col  = {"naive": "#95a5a6", "hard": "#e74c3c", "soft": "#8e44ad"}.get(best, "black")
        ax.text(i, max(row[["naive_regret","hard_regret","soft_regret"]].abs()) * 1.05,
                f"✓{best}", ha="center", fontsize=7, color=col, fontweight="bold")

    # Summary panel
    ax2 = axes[1]
    ax2.axis("off")
    cols   = ["event", "regime", "naive_score", "naive_regret",
              "hard_score", "hard_regret", "soft_score", "soft_regret", "best_policy"]
    subset = comparison_df[cols].copy()
    for c in ["naive_score","hard_score","soft_score","naive_regret","hard_regret","soft_regret"]:
        subset[c] = subset[c].round(5)

    tbl = ax2.table(
        cellText  = subset.values,
        colLabels = subset.columns,
        loc       = "center",
        cellLoc   = "center",
    )
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(6)
    tbl.scale(1, 1.8)

    # Highlight best policy cells
    policy_col_idx = list(subset.columns).index("best_policy")
    for i, (_, row) in enumerate(subset.iterrows()):
        cell = tbl[i+1, policy_col_idx]
        best = row["best_policy"]
        cell.set_facecolor({"naive":"#dfe6e9","hard":"#fadbd8","soft":"#e8daef"}.get(best, "white"))

    mean_row_text = (
        f"\nMean regret — Naive: {summary['naive_regret']:.5f}  "
        f"Hard: {summary['hard_regret']:.5f}  "
        f"Soft: {summary['soft_regret']:.5f}  "
        f"→ Winner: {summary['best_policy'].upper()}"
    )
    ax2.text(0.5, 0.02, mean_row_text, transform=ax2.transAxes,
             ha="center", fontsize=8, style="italic",
             bbox=dict(boxstyle="round", facecolor="#f8f9fa", alpha=0.8))

    plt.tight_layout()
    path = os.path.join(CHART_DIR, "three_way_regret.png")
    plt.savefig(path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"    → three_way_regret.png")


# ─────────────────────────────────────────────
# Chart 2: Lambda Prior Sensitivity
# ─────────────────────────────────────────────

def chart_lambda_prior_sweep(
    curves: dict,
    rl_surfaces: dict,
    regime_results: dict,
):
    n_events = len(rl_surfaces)
    fig, axes = plt.subplots(2, n_events, figsize=(6 * n_events, 8))
    if n_events == 1:
        axes = axes.reshape(2, 1)

    fig.suptitle("Soft Prior — λ_prior Sensitivity\n(How aggressively must prior weight before selection shifts?)",
                 fontsize=12, fontweight="bold")

    for col, ek in enumerate(rl_surfaces):
        regime = regime_results[ek].regime
        sweep  = sweep_lambda_prior(curves, rl_surfaces[ek], regime)

        # Top panel: selected model family vs lambda_prior
        ax_top = axes[0, col]
        family_history = sweep["family"].tolist()
        unique_families = list(dict.fromkeys(family_history))  # preserve order

        family_colors = {
            "exp_decay": "#3498db", "piecewise": "#e74c3c",
            "power_law": "#2ecc71", "duration":  "#f39c12"
        }

        for i, (lp, fam) in enumerate(zip(sweep["lambda_prior"], sweep["family"])):
            color = family_colors.get(fam, "#95a5a6")
            ax_top.scatter(lp, i, s=200, color=color, zorder=3)
            ax_top.text(lp * 1.05, i, fam[:12], fontsize=7, va="center")

        ax_top.set_yticks(range(len(sweep)))
        ax_top.set_yticklabels([f"λ={lp}" for lp in sweep["lambda_prior"]], fontsize=7)
        ax_top.set_xlabel("λ_prior")
        ax_top.set_title(f"{EVENTS[ek]['name']}\n[{regime}]\nSelected Family vs λ_prior", fontsize=9)
        ax_top.set_xlim(0, max(LAMBDA_PRIOR_SWEEP) * 1.4)
        ax_top.grid(axis="x", alpha=0.3)

        # Bottom panel: regret vs lambda_prior
        ax_bot = axes[1, col]
        ax_bot.plot(sweep["lambda_prior"], sweep["regret"].abs(),
                    marker="o", color="#8e44ad", linewidth=1.8, markersize=6)
        ax_bot.fill_between(sweep["lambda_prior"], sweep["regret"].abs(), alpha=0.2, color="#8e44ad")
        ax_bot.axhline(0, color="gray", linestyle="--", linewidth=0.8)
        ax_bot.set_xlabel("λ_prior")
        ax_bot.set_ylabel("Regret")
        ax_bot.set_title("Regret vs λ_prior", fontsize=9)
        ax_bot.grid(alpha=0.3)

        # Annotate optimal lambda
        min_regret_idx = sweep["regret"].abs().idxmin()
        opt_lambda     = sweep.loc[min_regret_idx, "lambda_prior"]
        opt_regret     = sweep.loc[min_regret_idx, "regret"]
        ax_bot.axvline(opt_lambda, color="#e74c3c", linestyle=":", linewidth=1.2)
        ax_bot.text(opt_lambda + 0.01, sweep["regret"].abs().max() * 0.9,
                    f"opt λ={opt_lambda}", fontsize=7, color="#e74c3c")

    plt.tight_layout()
    path = os.path.join(CHART_DIR, "lambda_prior_sweep.png")
    plt.savefig(path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"    → lambda_prior_sweep.png")


# ─────────────────────────────────────────────
# Chart 3: Penalty Matrix Heatmap
# ─────────────────────────────────────────────

def chart_penalty_matrix():
    from src.scoring.soft_prior import PENALTY_MATRIX
    regimes  = list(PENALTY_MATRIX.keys())
    families = ["exp_decay", "piecewise", "power_law", "duration"]

    matrix = np.array([
        [PENALTY_MATRIX[r].get(f, 0.05) for f in families]
        for r in regimes
    ])

    fig, ax = plt.subplots(figsize=(8, 4))
    im = ax.imshow(matrix, cmap="YlOrRd", aspect="auto", vmin=0, vmax=0.25)
    plt.colorbar(im, ax=ax, label="Penalty (0=preferred, higher=penalized)")

    ax.set_xticks(range(len(families)))
    ax.set_xticklabels(families, fontsize=10)
    ax.set_yticks(range(len(regimes)))
    ax.set_yticklabels(regimes, fontsize=9)

    for i in range(len(regimes)):
        for j in range(len(families)):
            val = matrix[i, j]
            ax.text(j, i, f"{val:.2f}", ha="center", va="center",
                    fontsize=11, fontweight="bold",
                    color="white" if val > 0.12 else "black")

    ax.set_title("Soft Prior Penalty Matrix\n(Economic intuition encoded as explicit priors — version controlled)",
                 fontsize=11, fontweight="bold")
    plt.tight_layout()
    path = os.path.join(CHART_DIR, "penalty_matrix.png")
    plt.savefig(path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"    → penalty_matrix.png")


# ─────────────────────────────────────────────
# Ambiguity as Operational Risk State
# ─────────────────────────────────────────────

def chart_ambiguity_policy(
    curves: dict,
    rl_surfaces: dict,
    regime_results: dict,
):
    """
    Demonstrates ambiguity as a risk state with policy implications:
      - ambiguous → low penalty differentiation → broad search
      - known regime → higher penalty differentiation → guided search
    
    Visualization: search space reduction by regime
    """
    from src.scoring.soft_prior import PENALTY_MATRIX

    fig, ax = plt.subplots(figsize=(9, 4))
    fig.suptitle("Ambiguity as Operational Risk State\nSearch space guidance by regime",
                 fontsize=11, fontweight="bold")

    regimes  = list(PENALTY_MATRIX.keys())
    families = ["exp_decay", "piecewise", "power_law", "duration"]

    # Penalty spread = differentiation = how much the prior constrains search
    spreads = []
    for r in regimes:
        penalties = [PENALTY_MATRIX[r].get(f, 0.05) for f in families]
        spreads.append(max(penalties) - min(penalties))

    colors = ["#e74c3c" if r == "ambiguous" else "#8e44ad" for r in regimes]
    bars   = ax.barh(regimes, spreads, color=colors, alpha=0.8)
    ax.axvline(0.05, color="gray", linestyle="--", linewidth=0.8, label="Minimum guidance threshold")
    ax.set_xlabel("Penalty Spread (max - min across families)")
    ax.set_title("Higher spread = stronger search guidance\nambiguous → near-zero spread = full search space preserved")

    for bar, val, regime in zip(bars, spreads, regimes):
        label = "← FULL SEARCH" if regime == "ambiguous" else f"Δ={val:.2f}"
        ax.text(bar.get_width() + 0.003, bar.get_y() + bar.get_height()/2,
                label, va="center", fontsize=9,
                color="#e74c3c" if regime == "ambiguous" else "black")
    ax.legend(fontsize=8)
    ax.grid(axis="x", alpha=0.3)

    plt.tight_layout()
    path = os.path.join(CHART_DIR, "ambiguity_policy.png")
    plt.savefig(path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"    → ambiguity_policy.png")


# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────

def main():
    print("\n=== Dsrpt Experiment Harness v2.1 ===")
    print("Soft Prior Selection — Three-Way Policy Comparison\n")
    os.makedirs(CHART_DIR, exist_ok=True)

    print("[1/5] Loading data and building RL surfaces...")
    raw_data = fetch_all_events(EVENTS, cache_dir="data/raw")
    rl_surfaces, enriched = {}, {}
    for ek, cfg in EVENTS.items():
        if ek not in raw_data:
            continue
        df, rl = build_realized_loss_surface(raw_data[ek], cfg)
        enriched[ek], rl_surfaces[ek] = df, rl

    print("\n[2/5] Classifying regimes (v2)...")
    regime_results = {ek: classify_event(enriched[ek], ek) for ek in rl_surfaces}
    for ek, r in regime_results.items():
        print(f"  {ek}: {r.regime} ({r.confidence})")

    print("\n[3/5] Three-way selection comparison...")
    curves = get_all_families(GRID)
    print(f"  Curve pool: {len(curves)} models")

    comparison, summary = three_way_comparison(
        curves, rl_surfaces, regime_results,
        lambda_prior=LAMBDA_PRIOR_DEFAULT,
    )

    print(f"\n  Per-event results:")
    print(comparison[[
        "event", "regime", "naive_regret", "hard_regret", "soft_regret", "best_policy"
    ]].to_string(index=False))
    print(f"\n  Mean regret:")
    print(f"    naive: {summary['naive_regret']:.6f}")
    print(f"    hard:  {summary['hard_regret']:.6f}")
    print(f"    soft:  {summary['soft_regret']:.6f}")
    print(f"    winner: {summary['best_policy'].upper()}")

    print("\n[4/5] λ_prior sensitivity sweep...")
    for ek in rl_surfaces:
        regime = regime_results[ek].regime
        sweep  = sweep_lambda_prior(curves, rl_surfaces[ek], regime)
        print(f"\n  {ek} [{regime}]:")
        print(sweep[["lambda_prior","family","raw_score","regret"]].to_string(index=False))

    print("\n[5/5] Generating charts...")
    chart_three_way_regret(comparison, summary)
    chart_lambda_prior_sweep(curves, rl_surfaces, regime_results)
    chart_penalty_matrix()
    chart_ambiguity_policy(curves, rl_surfaces, regime_results)

    # Export
    comparison.to_csv(os.path.join(OUT_DIR, "three_way_comparison.csv"), index=False)
    pd.DataFrame([summary]).to_csv(os.path.join(OUT_DIR, "summary.csv"), index=False)
    print(f"    → three_way_comparison.csv")
    print(f"    → summary.csv")

    print("\n=== Harness v2.1 Complete ===")
    print("\nKey result interpretation:")
    print("  soft_regret < naive_regret  →  prior adds value, conditioning justified")
    print("  soft_regret > naive_regret  →  prior is too strong, reduce λ_prior")
    print("  hard_regret >> naive_regret →  hard restriction is bottleneck (expected)")
    print(f"\n  Penalty matrix is version-controlled in soft_prior.py")
    print(f"  Any change to penalties must be justified and benchmarked against this run.")


if __name__ == "__main__":
    main()
