"""
Dsrpt Phase 1 — Experiment Harness

Per-event output:
  ✓ Realized loss curve
  ✓ Regime classification + features
  ✓ Top-N model fits (parametric families)
  ✓ Sensitivity table (λ, grid, liquidity, duration)
  ✓ Stability verdict (STABLE / UNSTABLE)
  ✓ Cross-event regime × model matrix

Run: python harness.py
"""

import os
import sys
import json
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from matplotlib.colors import LinearSegmentedColormap

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from src.config import EVENTS, ATTACHMENT_LEVELS, LAMBDA_TAIL
from src.collectors.coingecko import fetch_all_events
from src.pipeline.rl_surface import build_realized_loss_surface
from src.scoring.score import score_curve
from src.scoring.curve_families import get_all_families, get_regime_prior_families
from src.regime.classifier import classify_event, features_to_df
from src.sensitivity.sweep import run_full_sensitivity

OUT_DIR    = "output/harness"
CHART_DIR  = os.path.join(OUT_DIR, "charts")
DATA_DIR   = "data/processed"
GRID       = "medium"   # coarse / medium / fine
TOP_N      = 5


# ─────────────────────────────────────────────
# Scoring helpers
# ─────────────────────────────────────────────

def score_all_curves(curves: dict, rl_curve: pd.DataFrame, lam: float = LAMBDA_TAIL) -> pd.DataFrame:
    rows = []
    for name, fn in curves.items():
        res = score_curve(fn, rl_curve, lam=lam)
        rows.append({
            "model":  name,
            "score":  res["score"],
            "mse":    res["mse_unweighted"],
            "family": name.split("_")[0],
        })
    return pd.DataFrame(rows).sort_values("score", ascending=False).reset_index(drop=True)


# ─────────────────────────────────────────────
# Chart: Per-Event Summary (4 panels)
# ─────────────────────────────────────────────

def chart_event_summary(
    enriched_df: pd.DataFrame,
    rl_curve: pd.DataFrame,
    rankings: pd.DataFrame,
    sensitivity: dict,
    regime_result,
    event_key: str,
    event_cfg: dict,
):
    fig = plt.figure(figsize=(18, 12))
    fig.suptitle(
        f"{event_cfg['name']}  |  Regime: {regime_result.regime.upper()}  ({regime_result.confidence} confidence)",
        fontsize=14, fontweight="bold", y=0.98
    )
    gs = gridspec.GridSpec(2, 3, figure=fig, hspace=0.40, wspace=0.35)

    # ── Panel A: Severity time series ──
    ax_a = fig.add_subplot(gs[0, 0])
    ax_a.fill_between(enriched_df["timestamp"], enriched_df["adjusted_severity"],
                      alpha=0.6, color="#e74c3c", label="I*(t)")
    ax_a.plot(enriched_df["timestamp"], enriched_df["severity"],
              color="#c0392b", linewidth=0.8, alpha=0.5, label="I(t) raw")
    ax_a.set_title("Depeg Severity Over Time", fontsize=10)
    ax_a.set_ylabel("Severity")
    ax_a.legend(fontsize=7)
    ax_a.tick_params(axis="x", labelrotation=30, labelsize=7)
    ax_a.grid(alpha=0.3)

    # ── Panel B: RL curve + top 5 models ──
    ax_b = fig.add_subplot(gs[0, 1])
    x = rl_curve["attachment"].values
    ax_b.plot(x, rl_curve["rl_prob"], color="#f39c12", linewidth=2.5,
              marker="o", markersize=4, label="RL(x) realized", zorder=5)

    colors = plt.cm.viridis(np.linspace(0.2, 0.85, min(TOP_N, len(rankings))))
    for i, (_, row) in enumerate(rankings.head(TOP_N).iterrows()):
        fn_name = row["model"]
        curves  = get_all_families(GRID)
        if fn_name in curves:
            el_vals = [curves[fn_name](xi) for xi in x]
            ax_b.plot(x, el_vals, color=colors[i], linewidth=1.2,
                      linestyle="--", label=f"#{i+1} {fn_name[:18]}", alpha=0.85)

    ax_b.set_title(f"Top-{TOP_N} Models vs Realized Loss", fontsize=10)
    ax_b.set_xlabel("Attachment Level")
    ax_b.set_ylabel("Probability")
    ax_b.legend(fontsize=6, loc="upper right")
    ax_b.grid(alpha=0.3)
    ax_b.set_ylim(-0.05, 1.05)

    # ── Panel C: Score table ──
    ax_c = fig.add_subplot(gs[0, 2])
    ax_c.axis("off")
    top5 = rankings.head(TOP_N)[["model", "score", "mse"]].copy()
    top5["score"] = top5["score"].round(5)
    top5["mse"]   = top5["mse"].round(5)
    top5.insert(0, "rank", range(1, len(top5)+1))
    top5["model"] = top5["model"].str[:22]

    tbl = ax_c.table(
        cellText  = top5.values,
        colLabels = top5.columns,
        loc       = "center",
        cellLoc   = "center",
    )
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(7)
    tbl.scale(1, 1.4)
    ax_c.set_title(f"Score Table (λ={LAMBDA_TAIL})", fontsize=10)

    # ── Panel D: λ sensitivity ──
    ax_d = fig.add_subplot(gs[1, 0])
    lam_df, lam_stab = sensitivity["lambda_sweep"]
    for model, grp in lam_df[lam_df["rank"] <= 3].groupby("model"):
        ax_d.plot(grp["lambda"], grp["rank"], marker="o", markersize=4,
                  label=model[:18], linewidth=1.2)
    ax_d.invert_yaxis()
    ax_d.set_xlabel("λ (tail weight)")
    ax_d.set_ylabel("Rank")
    ax_d.set_title(f"λ Sensitivity  [{lam_stab['verdict']}]", fontsize=9)
    ax_d.legend(fontsize=6)
    ax_d.grid(alpha=0.3)

    # ── Panel E: Liquidity scheme sensitivity ──
    ax_e = fig.add_subplot(gs[1, 1])
    liq_df, liq_stab = sensitivity["liquidity_sweep"]
    pivot = liq_df[liq_df["rank"] <= 3].pivot_table(
        index="model", columns="scheme", values="rank", aggfunc="min"
    )
    if not pivot.empty:
        pivot.T.plot(ax=ax_e, marker="o", markersize=4, linewidth=1.2)
        ax_e.invert_yaxis()
        ax_e.set_title(f"Liquidity Scheme Sensitivity\n[{liq_stab['verdict']}]", fontsize=9)
        ax_e.set_ylabel("Rank")
        ax_e.legend(fontsize=6)
        ax_e.grid(alpha=0.3)

    # ── Panel F: Regime features radar-style bar ──
    ax_f = fig.add_subplot(gs[1, 2])
    f = regime_result.features
    feature_names = ["max_sev", "init_1h", "persistence", "vol_spike", "terminal_sev"]
    feature_vals  = [
        f.max_severity,
        f.initial_drop_1h,
        f.severity_persistence,
        min(f.volume_spike_ratio / 10, 1.0),  # normalize spike ratio
        f.terminal_severity,
    ]
    bars = ax_f.barh(feature_names, feature_vals,
                     color=["#e74c3c","#e67e22","#f1c40f","#2ecc71","#3498db"])
    ax_f.set_xlim(0, 1.0)
    ax_f.set_title(f"Regime Features\n{regime_result.notes[:60]}...", fontsize=9)
    ax_f.grid(axis="x", alpha=0.3)
    for bar, val in zip(bars, feature_vals):
        ax_f.text(bar.get_width() + 0.01, bar.get_y() + bar.get_height()/2,
                  f"{val:.3f}", va="center", fontsize=7)

    plt.savefig(os.path.join(CHART_DIR, f"{event_key}_harness.png"), dpi=150, bbox_inches="tight")
    plt.close()
    print(f"    → {event_key}_harness.png")


# ─────────────────────────────────────────────
# Chart: Cross-Event Regime × Model Matrix
# ─────────────────────────────────────────────

def chart_cross_event_matrix(all_rankings: dict, all_regimes: dict):
    """
    Heatmap: events (rows) × model families (cols) colored by top-5 score rank.
    Reveals whether model preference clusters by regime.
    """
    # Get unique families
    families = ["exp_decay", "piecewise", "power_law", "duration"]
    event_keys = list(all_rankings.keys())

    # For each event and family, find the best-ranked model from that family
    matrix = np.full((len(event_keys), len(families)), np.nan)
    for i, ek in enumerate(event_keys):
        df = all_rankings[ek]
        df = df.reset_index(drop=True)
        df["rank"] = df.index + 1
        for j, fam in enumerate(families):
            fam_rows = df[df["model"].str.startswith(fam)]
            if not fam_rows.empty:
                best_rank = fam_rows["rank"].min()
                matrix[i, j] = best_rank

    fig, ax = plt.subplots(figsize=(10, 4))
    cmap = LinearSegmentedColormap.from_list("rank_cmap", ["#2ecc71", "#f1c40f", "#e74c3c"])

    im = ax.imshow(matrix, cmap=cmap, aspect="auto", vmin=1, vmax=20)
    plt.colorbar(im, ax=ax, label="Best family rank (lower=better)")

    ax.set_xticks(range(len(families)))
    ax.set_xticklabels(families, fontsize=10)
    ax.set_yticks(range(len(event_keys)))
    event_labels = [f"{ek}\n[{all_regimes[ek].regime}]" for ek in event_keys]
    ax.set_yticklabels(event_labels, fontsize=9)

    for i in range(len(event_keys)):
        for j in range(len(families)):
            if not np.isnan(matrix[i, j]):
                ax.text(j, i, f"#{int(matrix[i,j])}", ha="center", va="center",
                        fontsize=10, fontweight="bold",
                        color="white" if matrix[i,j] > 5 else "black")

    ax.set_title("Cross-Event: Best Rank by Curve Family\n(Green=top-ranked, Red=bottom-ranked)",
                 fontsize=12, fontweight="bold")

    plt.tight_layout()
    plt.savefig(os.path.join(CHART_DIR, "cross_event_matrix.png"), dpi=150, bbox_inches="tight")
    plt.close()
    print(f"    → cross_event_matrix.png")


# ─────────────────────────────────────────────
# Main Harness
# ─────�─────────────────────────────────────
def main():
    print("\n=== Dsrpt Experiment Harness ===\n")
    os.makedirs(CHART_DIR, exist_ok=True)
    os.makedirs(DATA_DIR,  exist_ok=True)

    # 1. Load data
    print("[1/5] Loading event data...")
    raw_data = fetch_all_events(EVENTS, cache_dir="data/raw")

    # 2. Build RL surfaces
    print("\n[2/5] Building RL surfaces...")
    rl_surfaces, enriched = {}, {}
    for ek, cfg in EVENTS.items():
        if ek not in raw_data:
            continue
        df, rl = build_realized_loss_surface(raw_data[ek], cfg)
        enriched[ek], rl_surfaces[ek] = df, rl

    # 3. Classify regimes
    print("\n[3/5] Classifying regimes...")
    regime_results = {}
    for ek in rl_surfaces:
        r = classify_event(enriched[ek], ek)
        regime_results[ek] = r
        print(f"  {ek}: {r.regime} ({r.confidence}) — {r.rules_fired[0]}")

    # 4. Score + sensitivity per event
    print("\n[4/5] Scoring and sensitivity analysis...")
    all_rankings  = {}
    all_sensitivity = {}
    curves = get_all_families(GRID)
    print(f"  Testing {len(curves)} parametric curves ({GRID} grid)...")

    for ek in rl_surfaces:
        print(f"\n  {EVENTS[ek]['name']}:")
        rankings = score_all_curves(curves, rl_surfaces[ek])
        all_rankings[ek] = rankings
        print(f"    Top model: {rankings.iloc[0]['model']}  score={rankings.iloc[0]['score']:.5f}")

        print(f"  Sensitivity sweeps...")
        sens = run_full_sensitivity(raw_data[ek], ek, EVENTS[ek], rl_surfaces[ek], curves, top_n=TOP_N)
        all_sensitivity[ek] = sens

        for sweep_name, (_, stab) in sens.items():
            status = "✓" if stab["passed"] else "✗"
            print(f"    {status} {sweep_name}: {stab['verdict']}")

    # 5. Charts + export
    print("\n[5/5] Generating output...")
    for ek in rl_surfaces:
        chart_event_summary(
            enriched[ek], rl_surfaces[ek], all_rankings[ek],
            all_sensitivity[ek], regime_results[ek], ek, EVENTS[ek]
        )

    chart_cross_event_matrix(all_rankings, regime_results)

    # Export feature table
    feat_df = features_to_df(list(regime_results.values()))
    feat_df.to_csv(os.path.join(OUT_DIR, "regime_features.csv"), index=False)
    print(f"    → regime_features.csv")

    # Export top-5 per event
    for ek, rankings in all_rankings.items():
        rankings.head(TOP_N).to_csv(
            os.path.join(OUT_DIR, f"{ek}_top{TOP_N}.csv"), index=False
        )

    print("\n=== Harness Complete ===")
    print("\nKey questions to answer from output:")
    print("  1. Does cross_event_matrix show family preference clustering by regime?")
    print("  2. Are λ-sensitivity plots flat (stable) or steep (unstable)?")
    print("  3. Do regime-prior families outperform naive best-fit?")
    print("\nIf (1) yes + (2) flat: the mechanism is valid. Build Phase 2.")
    print("If (2) steep: recalibrate λ or RL construction before proceeding.")


if __name__ == "__main__":
    main()
