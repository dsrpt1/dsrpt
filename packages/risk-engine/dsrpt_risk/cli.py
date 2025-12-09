"""
Command-line interface for DSRPT Risk Engine.
"""

import json
from pathlib import Path

import click
from rich.console import Console
from rich.table import Table

console = Console()


@click.group()
@click.version_option()
def main():
    """DSRPT Risk Engine CLI - Hazard curve calibration and risk management."""
    pass


@main.command()
@click.option("--config", "-c", type=click.Path(exists=True), help="Config file path")
@click.option("--output", "-o", type=click.Path(), help="Output file for curves")
@click.option("--simulations", "-n", type=int, default=10000, help="Monte Carlo simulations")
def calibrate(config: str, output: str, simulations: int):
    """Calibrate hazard curves from historical data."""
    from dsrpt_risk import RiskEngine

    console.print("[bold blue]DSRPT Risk Engine - Calibration[/bold blue]")

    # Load engine
    engine = RiskEngine.from_config(config)

    # For demo, generate synthetic data
    import numpy as np

    np.random.seed(42)
    n_days = 365
    prices = 1 - np.abs(np.random.normal(0, 0.002, n_days))  # Slight deviations

    console.print(f"Loading {n_days} days of price data...")
    engine.load_data(prices)

    # Classify current regime
    regime = engine.classify_regime()
    console.print(f"Current regime: [bold]{regime.name}[/bold]")

    # Calibrate
    console.print(f"Running calibration with {simulations} simulations...")
    curves = engine.calibrate(n_simulations=simulations)

    # Display results
    table = Table(title="Calibrated Hazard Curves")
    table.add_column("Regime", style="cyan")
    table.add_column("H(7d)", justify="right")
    table.add_column("H(30d)", justify="right")
    table.add_column("H(90d)", justify="right")
    table.add_column("Tail Slope", justify="right")

    for name, curve in [
        ("CALM", curves.calm),
        ("VOLATILE", curves.volatile),
        ("CRISIS", curves.crisis),
    ]:
        table.add_row(
            name,
            f"{curve.H_7d / 1e18:.6f}",
            f"{curve.H_30d / 1e18:.6f}",
            f"{curve.H_90d / 1e18:.6f}",
            f"{curve.tail_slope / 1e18:.8f}",
        )

    console.print(table)

    # Save if output specified
    if output:
        output_data = curves.to_curve_config()
        Path(output).write_text(json.dumps(output_data, indent=2))
        console.print(f"[green]Saved curves to {output}[/green]")


@main.command()
@click.option("--config", "-c", type=click.Path(exists=True), help="Config file path")
@click.option("--curves", type=click.Path(exists=True), help="Curves JSON file")
def validate(config: str, curves: str):
    """Validate calibrated hazard curves."""
    from dsrpt_risk.calibration import CurveValidator, RegimeCurveSet, HazardCurve
    from dsrpt_risk.models import RegimeKind

    console.print("[bold blue]DSRPT Risk Engine - Validation[/bold blue]")

    validator = CurveValidator()

    if curves:
        data = json.loads(Path(curves).read_text())
        # Reconstruct curves from JSON
        curve_set = RegimeCurveSet(
            peril_id=data["perilId"],
            calm=HazardCurve(
                regime=RegimeKind.CALM,
                H_7d=data["regimeCurves"][0][0][1],
                H_30d=data["regimeCurves"][0][1][1],
                H_90d=data["regimeCurves"][0][2][1],
                tail_slope=data["regimeCurves"][0][3],
            ),
            volatile=HazardCurve(
                regime=RegimeKind.VOLATILE,
                H_7d=data["regimeCurves"][1][0][1],
                H_30d=data["regimeCurves"][1][1][1],
                H_90d=data["regimeCurves"][1][2][1],
                tail_slope=data["regimeCurves"][1][3],
            ),
            crisis=HazardCurve(
                regime=RegimeKind.CRISIS,
                H_7d=data["regimeCurves"][2][0][1],
                H_30d=data["regimeCurves"][2][1][1],
                H_90d=data["regimeCurves"][2][2][1],
                tail_slope=data["regimeCurves"][2][3],
            ),
        )

        results = validator.validate(curve_set)
        report = validator.generate_report(results)
        console.print(report)
    else:
        console.print("[yellow]No curves file specified. Use --curves option.[/yellow]")


@main.command()
@click.option("--config", "-c", type=click.Path(exists=True), help="Config file path")
@click.option("--vol", type=int, default=300, help="Current volatility in bps")
@click.option("--disagreement", type=int, default=20, help="Cross-venue disagreement in bps")
@click.option("--shock", type=int, default=0, help="Shock flag (0/1/2)")
@click.option("--book-notional", type=float, default=1000000, help="Book notional in USD")
def hedge(config: str, vol: int, disagreement: int, shock: int, book_notional: float):
    """Compute meta-hedging positions."""
    from dsrpt_risk.hedging import MetaHedger
    from dsrpt_risk.hedging.positions import OracleSnapshot, PortfolioSnapshot

    console.print("[bold blue]DSRPT Risk Engine - Hedging[/bold blue]")

    hedger = MetaHedger()

    oracle = OracleSnapshot(
        peg_dev_bps=0,
        vol_bps=vol,
        disagreement_bps=disagreement,
        shock_flag=shock,
    )

    portfolio = PortfolioSnapshot(
        book_notional=book_notional,
        expected_premium=book_notional * 0.05,  # 5% expected premium
        utilization_bps=7000,
        capital_ratio_bps=12000,
    )

    positions = hedger.compute_hedge_positions(oracle, portfolio)

    table = Table(title="Recommended Hedge Positions")
    table.add_column("Type", style="cyan")
    table.add_column("Underlying")
    table.add_column("Notional", justify="right")
    table.add_column("Rationale")

    for pos in positions:
        table.add_row(
            pos.hedge_type.value,
            pos.underlying,
            f"${pos.notional:,.0f}",
            pos.rationale[:50] + "..." if len(pos.rationale) > 50 else pos.rationale,
        )

    console.print(table)


@main.command()
@click.option("--rpc-url", envvar="RPC_URL", help="RPC endpoint URL")
@click.option("--peril-id", default="USDC_depeg", help="Peril identifier")
@click.option("--hazard-engine", envvar="HAZARD_ENGINE", help="HazardEngine address")
def status(rpc_url: str, peril_id: str, hazard_engine: str):
    """Check on-chain protocol status."""
    from dsrpt_risk.utils import Web3Client

    console.print("[bold blue]DSRPT Risk Engine - Status[/bold blue]")

    if not rpc_url or not hazard_engine:
        console.print("[yellow]Set RPC_URL and HAZARD_ENGINE environment variables.[/yellow]")
        return

    client = Web3Client(rpc_url=rpc_url, hazard_engine=hazard_engine)

    try:
        oracle_state = client.get_oracle_state(peril_id)
        portfolio_state = client.get_portfolio_state(peril_id)
        regime = client.get_current_regime(peril_id)

        regime_names = {0: "CALM", 1: "VOLATILE", 2: "CRISIS"}

        table = Table(title=f"Protocol Status - {peril_id}")
        table.add_column("Metric", style="cyan")
        table.add_column("Value", justify="right")

        table.add_row("Current Regime", regime_names.get(regime, str(regime)))
        table.add_row("Peg Deviation", f"{oracle_state['peg_dev_bps']} bps")
        table.add_row("Volatility", f"{oracle_state['vol_bps']} bps")
        table.add_row("Disagreement", f"{oracle_state['disagreement_bps']} bps")
        table.add_row("Shock Flag", str(oracle_state["shock_flag"]))
        table.add_row("Utilization", f"{portfolio_state['utilization_bps'] / 100:.1f}%")
        table.add_row("Capital Ratio", f"{portfolio_state['capital_ratio_bps'] / 100:.1f}%")

        console.print(table)

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


@main.command()
@click.option("--config", "-c", type=click.Path(exists=True), help="Config file path")
def run(config: str):
    """Run the risk engine daemon (continuous monitoring)."""
    import asyncio

    console.print("[bold blue]DSRPT Risk Engine - Daemon Mode[/bold blue]")
    console.print("Starting continuous monitoring...")
    console.print("Press Ctrl+C to stop\n")

    from dsrpt_risk.daemon import main as daemon_main

    try:
        asyncio.run(daemon_main(config))
    except KeyboardInterrupt:
        console.print("\n[yellow]Daemon stopped by user[/yellow]")


if __name__ == "__main__":
    main()
