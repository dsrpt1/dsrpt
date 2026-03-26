"""
Dsrpt Experiment Harness v2

Key additions over v1:
  - Regime Classifier v2 (trajectory-aware)
  - Regime-conditioned model selection vs naive best-fit comparison
  - v2 trajectory feature visualization per event
  - Classifier diff: v1 vs v2 per event

The critical test:
  Does regime-conditioned model selection outperform naive?
  If yes: the regime layer has real economic value, not just taxonomic value.
"""

import os
import sys
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
from src.regime.classifier    import classify_event as classify_v1
from src.regime.classifier_v2 import classify_event as classify_v2, features_to_df

OUT_DIR   = "output/harness_v2"
CHART_DIR = os.path.join(OUT_DIR, "charts")
GRID      = "medium"
TOP_N     = 5


# ─────────────────────────────────────────────
# Score helpers
# ─────────────────────────────────────────────

def score_all(curves: dict, rl_curve: pd.DataFrame, lam: float = LAMBDA_TAIL) -> pd.DataFrame:
    rows = []
    for name, fn in curves.items():
        res = score_curve(fn, rl_curve, lam=lam)
        rows.append({"model": name, "score": res["score"], "mse": res["mse_unweighted"],
                     "family": name.split("_")[0]})
    return pd.DataFrame(rows).sort_values("score", ascending=False).reset_index(drop=True)


# ─────────────────────────────────────────────
# Regime-conditioned vs naive comparison
# ─────────────────────────────────────────────

def compare_regime_conditioned_vs_naive(
    all_curves: dict,
    rl_surfaces: dict,
    regime_results: dict,
) -> pd.DataFrame:
    """
    For each event:
      naive:      rank all 33 curves, take top-1 score
      conditioned: restrict to regime-prior family, take top-1 score

    Result: does conditioning help?
    If conditioned_score > naive_score consistently: regime layer adds value.
    Note: since we test on same events used to define priors, this is
    in-sample. Phase 2 will test out-of-sample. Flag this clearly.
    """
    rows = []
    for ek, rl in rl_surfaces.items():
        regime = regime_results[ek].regime

        # Naive: best across all curves
        naive_rankings = score_all(all_curves, rl)
        naive_best     = naive_rankings.iloc[0]

        # Conditioned: best within regime prior family
        prior_curves   = get_regime_prior_families(regime)
        if len(prior_curves) == 0:
            prior_curves = all_curves
        conditioned_rankings = score_all(prior_curves, rl)
        cond_best = conditioned_rankings.iloc[0]

        rows.append({
            "event":              ek,
            "regime":             regime,
            "naive_best_model":   naive_best["model"],
            "naive_score":        round(naive_best["score"], 6),
            "cond_best_model":    cond_best["model"],
            "cond_score":         round(cond_best["score"], 6),
            "score_delta":        round(cond_best["score"] - naive_best["score"], 6),
            "cond_wins":          cond_best["score"] >= naive_best["score"] * 0.98,  # within 2%
            "prior_pool_size":    len(prior_curves),
            "note":               "IN-SAMPLE — out-of-sample test required in Phase 2",
        })
    return pd.DataFrame(rows)


# ─────────────────────────────────────────────
# Chart: Trajectory Feature Radar
# ─────────────────────────────────────────────

def chart_trajectory_features(regime_results_v2: dict, regime_results_v1: dict):
    """
    Side-by-side trajectory feature comparison across events.
    Highlights the new v2 features that separate UST from USDC.
    """
    features_list = ["monotonicity_score", "recovery_completeness",
                     "early_late_ratio_norm", "deterioration_run_norm",
                     "severity_auc", "severity_persistence"]
    event_keys = list(regime_results_v2.keys())
    n_events   = len(event_keys)

    fig, axes = plt.subplots(1, n_events, figsize=(6 * n_events, 5))
    if n_events == 1:
        axes = [axes]

    fig.suptitle("Regime Classifier v2 — Trajectory Feature Profiles\n(Bars show normalized feature values)",
                 fontsize=12, fontweight="bold")

    regime_colors = {
        "reflexive_collapse":    "#e74c3c",
        "collateral_shock":      "#3498db",
        "contained_stress":      "#2ecc71",
        "liquidity_dislocation": "#f39c12",
        "ambiguous":             "#95a5a6",
    }

    for ax, ek in zip(axes, event_keys):
        r  = regime_results_v2[ek]
        f  = r.features
        r1 = regime_results_v1[ek]

        vals = [
            f.monotonicity_score,
            f.recovery_completeness,
            min(f.early_late_ratio / 5.0, 1.0),           # normalize ratio to [0,1]
            min(f.deterioration_run / f.total_hours, 1.0), # normalize by window
            f.severity_auc,
            f.severity_persistence,
        ]
        labels = ["monotonicity", "recovery\ncompleteness", "early/late\nratio (norm)",
                  "deterioration\nrun (norm)", "severity\nAUC", "severity\npersistence"]

        color = regime_colors.get(r.regime, "#95a5a6")
        bars  = ax.barh(labels, vals, color=color, alpha=0.8)
        ax.set_xlim(0, 1.05)

        v1_label = f"v1: {r1.regime}"
        v2_label = f"v2: {r.regime}"
        flip     = r.regime != r1.regime
        title_suffix = " ← FLIPPED" if flip else ""

        ax.set_title(
            f"{EVENTS[ek]['name']}\n{v1_label} → {v2_label}{title_suffix}",
            fontsize=9, fontweight="bold" if flip else "normal",
            color="#e74c3c" if flip else "black"
        )
        ax.set_xlabel("Feature Value (normalized)")

        for bar, val in zip(bars, vals):
            ax.text(min(val + 0.02, 0.98), bar.get_y() + bar.get_height()/2,
                    f"{val:.2f}", va="center", fontsize=8)

        # Annotate rule fired
        rule = r.rules_fired[0][:45] if r.rules_fired else ""
        ax.text(0.5, -0.12, f"Rule: {rule}", transform=ax.transAxes,
                ha="center", fontsize=7, style="italic", color="#555")

    plt.tight_layout()
    path = os.path.join(CHART_DIR, "trajectory_features_v2.png")
    plt.savefig(path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"    → trajectory_features_v2.png")


# ─────────────────────────────────────────────
# Chart: Regime-conditioned vs Naive
# ─────────────────────────────────────────────

def chart_conditioned_vs_naive(comparison_df: pd.DataFrame):
    fig, axes = plt.subplots(1, 2, figsize=(13, 5))
    fig.suptitle("Regime-Conditioned vs Naive Model Selection\n(IN-SAMPLE — Phase 2 will test out-of-sample)",
                 fontsize=12, fontweight="bold")

    events = comparison_df["event"].tolist()
    x = np.arange(len(events))
    w = 0.35

    ax = axes[0]
    naive_scores = comparison_df["naive_score"].values
    cond_scores  = comparison_df["cond_score"].values

    bars1 = ax.bar(x - w/2, -naive_scores, w, label="Naive (all curves)", color="#95a5a6", alpha=0.8)
    bars2 = ax.bar(x + w/2, -cond_scores,  w, label="Regime-conditioned", color="#8e44ad", alpha=0.8)
    ax.set_xticks(x)
    ax.set_xticklabels([f"{e}\n[{comparison_df.loc[i,'regime']}]"
                        for i, e in enumerate(events)], fontsize=8)
    ax.set_ylabel("Weighted Error (lower = better)")
    ax.set_title("Score Comparison\n(bar height = error, lower is better)")
    ax.legend(fontsize=9)
    ax.grid(axis="y", alpha=0.3)

    ax2 = axes[1]
    ax2.axis("off")
    tbl_data = comparison_df[[
        "event", "regime", "naive_best_model", "naive_score",
        "cond_best_model", "cond_score", "cond_wins"
    ]].copy()
    tbl_data["naive_best_model"] = tbl_data["naive_best_model"].str[:20]
    tbl_data["cond_best_model"]  = tbl_data["cond_best_model"].str[:20]
    tbl_data["cond_wins"]        = tbl_data["cond_wins"].map({True: "✓", False: "✗"})

    tbl = ax2.table(
        cellText  = tbl_data.values,
        colLabels = tbl_data.columns,
        loc       = "center",
        cellLoc   = "center",
    )
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(6.5)
    tbl.scale(1, 1.6)
    ax2.set_title("Detailed Results", fontsize=10)

    plt.tight_layout()
    path = os.path.join(CHART_DIR, "regime_conditioned_vs_naive.png")
    plt.savefig(path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"    → regime_conditioned_vs_naive.png")


# ─────────────────────────────────────────────
# Chart: Cross-event matrix (regime-annotated)
# ─────────────────────────────────────────────

def chart_cross_event_matrix(all_rankings: dict, regime_results: dict):
    families   = ["exp_decay", "piecewise", "power_law", "duration"]
    event_keys = list(all_rankings.keys())

    matrix = np.full((len(event_keys), len(families)), np.nan)
    for i, ek in enumerate(event_keys):
        df = all_rankings[ek].reset_index(drop=True)
        df["rank"] = df.index + 1
        for j, fam in enumerate(families):
            fam_rows = df[df["model"].str.startswith(fam)]
            if not fam_rows.empty:
                matrix[i, j] = fam_rows["rank"].min()

    fig, ax = plt.subplots(figsize=(10, 4))
    cmap = LinearSegmentedColormap.from_list("rank", ["#2ecc71","#f1c40f","#e74c3c"])
    im   = ax.imshow(matrix, cmap=cmap, aspect="auto", vmin=1, vmax=15)
    plt.colorbar(im, ax=ax, label="Best family rank")

    ax.set_xticks(range(len(families)))
    ax.set_xticklabels(families, fontsize=10)
    ax.set_yticks(range(len(event_keys)))
    ax.set_yticklabels(
        [f"{ek}\n[{regime_results[ek].regime}]  ({regime_results[ek].confidence})"
         for ek in event_keys], fontsize=9
    )

    for i in range(len(event_keys)):
        for j in range(len(families)):
            if not np.isnan(matrix[i, j]):
                ax.text(j, i, f"#{int(matrix[i,j])}", ha="center", va="center",
                        fontsize=11, fontweight="bold",
                        color="white" if matrix[i,j] > 6 else "black")

    ax.set_title("Cross-Event: Best Rank by Curve Family  [v2 Regime Labels]",
                 fontsize=12, fontweight="bold")
    plt.tight_layout()
    path = os.path.join(CHART_DIR, "cross_event_matrix_v2.png")
    plt.savefig(path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"    → cross_event_matrix_v2.png")


# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────

def main():
    print("\n=== Dsrpt Experiment Harness v2 ===\n")
    os.makedirs(CHART_DIR, exist_ok=True)

    print("[1/6] Loading data...")
    raw_data = fetch_all_events(EVENTS, cache_dir="data/raw")

    print("\n[2/6] Building RL surfaces...")
    rl_surfaces, enriched = {}, {}
    for ek, cfg in EVENTS.items():
        if ek not in raw_data:
            continue
        df, rl = build_realized_loss_surface(raw_data[ek], cfg)
        enriched[ek], rl_surfaces[ek] = df, rl

    print("\n[3/6] Classifying regimes — v1 vs v2 comparison...")
    regime_v1 = {ek: classify_v1(enriched[ek], ek) for ek in rl_surfaces}
    regime_v2 = {ek: classify_v2(enriched[ek], ek) for ek in rl_surfaces}

    print(f"\n  {'Event':<15} {'v1':<22} {'v2':<22} {'Flipped?'}")
    print(f"  {'-'*70}")
    for ek in rl_surfaces:
        r1, r2 = regime_v1[ek], regime_v2[ek]
        flip = "← FLIPPED" if r1.regime != r2.regime else ""
        print(f"  {ek:<15} {r1.regime:<22} {r2.regime:<22} {flip}")
        if r2.rules_fired:
            print(f"  {'':>15} rule: {r2.rules_fired[0]}")

    print("\n[4/6] Scoring all curves...")
    all_curves   = get_all_families(GRID)
    all_rankings = {ek: score_all(all_curves, rl_surfaces[ek]) for ek in rl_surfaces}
    for ek, r in all_rankings.items():
        print(f"  {ek}: top={r.iloc[0]['model']}  score={r.iloc[0]['score']:.5f}")

    print("\n[5/6] Regime-conditioned vs naive comparison...")
    comparison = compare_regime_conditioned_vs_naive(all_curves, rl_surfaces, regime_v2)
    print(comparison[["event","regime","naive_score","cond_score","cond_wins","note"]].to_string(index=False))

    print("\n[6/6] Generating charts...")
    chart_trajectory_features(regime_v2, regime_v1)
    chart_conditioned_vs_naive(comparison)
    chart_cross_event_matrix(all_rankings, regime_v2)

    # Export
    feat_df = features_to_df(list(regime_v2.values()))
    feat_df.to_csv(os.path.join(OUT_DIR, "regime_features_v2.csv"), index=False)
    comparison.to_csv(os.path.join(OUT_DIR, "conditioned_vs_naive.csv"), index=False)
    print(f"    → regime_features_v2.csv")
    print(f"    → conditioned_vs_naive.csv")

    print("\n=== Harness v2 Complete ===")
    print("\nThe three questions this run answers:")
    print("  1. Did UST flip out of ambiguous? (check trajectory_features_v2.png)")
    print("  2. Did USDC stay bounded-shock or ambiguous-for-good-reason?")
    print("  3. Does regime-conditioned selection outperform naive? (check conditioned_vs_naive.png)")


if __name__ == "__main__":
    main()
