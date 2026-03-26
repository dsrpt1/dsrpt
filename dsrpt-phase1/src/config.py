"""
Dsrpt Phase 1 — Event Configuration
Three canonical depeg events covering distinct failure modes.
"""

EVENTS = {
    "UST_2022": {
        "name": "UST Collapse",
        "stablecoin": "UST",
        "start": "2022-05-07",
        "end": "2022-05-14",
        "failure_mode": "reflexive_death_spiral",
        "description": "Algorithmic stablecoin — reflexive depeg with no collateral floor",
        "attachment_range": (0.01, 0.50),   # 1% to 50% depeg
        "payout_duration_threshold_hours": 1.0,
    },
    "USDC_2023": {
        "name": "USDC Silicon Valley Bank Shock",
        "stablecoin": "USDC",
        "start": "2023-03-10",
        "end": "2023-03-13",
        "failure_mode": "collateral_impairment_shock",
        "description": "Reserve collateral impairment — sharp depeg with rapid recovery",
        "attachment_range": (0.005, 0.10),  # 0.5% to 10% depeg
        "payout_duration_threshold_hours": 2.0,
    },
    "FRAX_2023": {
        "name": "FRAX Stress Period",
        "stablecoin": "FRAX",
        "start": "2023-03-10",
        "end": "2023-03-15",
        "failure_mode": "partial_contained_stress",
        "description": "Partial-collateral hybrid — stress contagion, contained recovery",
        "attachment_range": (0.005, 0.08),  # 0.5% to 8% depeg
        "payout_duration_threshold_hours": 1.5,
    },
}

# Attachment levels to evaluate RL curve across (x-axis of scoring)
ATTACHMENT_LEVELS = [0.005, 0.01, 0.02, 0.03, 0.05, 0.075, 0.10, 0.15, 0.20, 0.30, 0.40, 0.50]

# Tail-weight parameter — exponential weighting for severity
# Higher λ = more aggressive tail penalty
LAMBDA_TAIL = 3.0

# Liquidity weight floor — prevents zero-liquidity manipulation
LIQUIDITY_WEIGHT_FLOOR = 0.01
