"""
Dsrpt Terminal — Database Persistence

Stores signal ticks and alerts in Postgres for the API and charting layers.

Tables:
  signal_ticks  — every 15-min tick per asset (regime, confidence, price, scores)
  signal_alerts — regime transitions and warnings (subset of ticks)

Env vars:
  DATABASE_URL — Postgres connection string (Railway provides this automatically)
"""

import os
import logging
from datetime import datetime
from typing import Optional

log = logging.getLogger("db")

try:
    import psycopg2
    from psycopg2.extras import Json
    HAS_PG = True
except ImportError:
    HAS_PG = False


def _to_float(v) -> float:
    """Convert numpy float64 or any numeric to plain Python float. Guards against NaN/inf."""
    if v is None:
        return 0.0
    f = float(v)
    if f != f or f == float('inf') or f == float('-inf'):  # NaN or inf
        return 0.0
    return f


def _to_int(v) -> int:
    """Convert numpy int or any numeric to plain Python int."""
    if v is None:
        return 0
    return int(v)

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS signal_ticks (
    id              BIGSERIAL PRIMARY KEY,
    asset           VARCHAR(16) NOT NULL,
    ts              TIMESTAMPTZ NOT NULL,
    price           DOUBLE PRECISION NOT NULL,
    volume          DOUBLE PRECISION,
    regime          VARCHAR(32) NOT NULL,
    regime_id       SMALLINT NOT NULL,
    confidence      DOUBLE PRECISION NOT NULL,
    escalation      SMALLINT NOT NULL DEFAULT 0,
    premium_mult    INTEGER NOT NULL DEFAULT 10000,
    peg_dev_bps     INTEGER NOT NULL DEFAULT 0,
    max_severity    DOUBLE PRECISION NOT NULL DEFAULT 0,
    partial_scores  JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS signal_alerts (
    id              BIGSERIAL PRIMARY KEY,
    asset           VARCHAR(16) NOT NULL,
    ts              TIMESTAMPTZ NOT NULL,
    signal_type     VARCHAR(16) NOT NULL,
    regime          VARCHAR(32) NOT NULL,
    prev_regime     VARCHAR(32),
    confidence      DOUBLE PRECISION NOT NULL,
    price           DOUBLE PRECISION NOT NULL,
    max_severity    DOUBLE PRECISION NOT NULL DEFAULT 0,
    rule_fired      TEXT,
    notes           TEXT,
    tx_hash         VARCHAR(66),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticks_asset_ts ON signal_ticks (asset, ts DESC);
CREATE INDEX IF NOT EXISTS idx_ticks_ts ON signal_ticks (ts DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_asset_ts ON signal_alerts (asset, ts DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_ts ON signal_alerts (ts DESC);
"""

# Regime name -> uint8 (matches OracleAdapter.Regime enum)
REGIME_TO_ID = {
    "ambiguous": 0,
    "contained_stress": 1,
    "liquidity_dislocation": 2,
    "collateral_shock": 3,
    "reflexive_collapse": 4,
}

# Escalation derivation (mirrors OracleAdapter._deriveEscalation)
def _derive_escalation(regime: str, confidence: float) -> int:
    if regime == "reflexive_collapse":
        return 3  # CRITICAL
    if regime == "collateral_shock":
        return 2 if confidence > 0.70 else 1
    if regime == "contained_stress":
        return 2 if confidence > 0.80 else 1
    if regime == "liquidity_dislocation":
        return 1  # ELEVATED
    return 0  # NORMAL

# Premium multiplier (mirrors OracleAdapter constants)
MULT = {
    "ambiguous": 10000,
    "contained_stress": 12500,
    "liquidity_dislocation": 11000,
    "collateral_shock": 15000,
    "reflexive_collapse": 99999,
}


class SignalDB:
    """Persists signal ticks and alerts to Postgres."""

    def __init__(self):
        self.enabled = False
        self.conn = None

        db_url = os.environ.get("DATABASE_URL", "")
        if not db_url:
            log.info("DATABASE_URL not set — persistence disabled")
            return

        if not HAS_PG:
            log.warning("psycopg2 not installed — persistence disabled")
            return

        try:
            self.conn = psycopg2.connect(db_url)
            self.conn.autocommit = True
            self._init_schema()
            self.enabled = True
            log.info("Database connected — persistence enabled")
        except Exception as e:
            log.error(f"Database connection failed: {e}")
            self.conn = None

    def _init_schema(self):
        with self.conn.cursor() as cur:
            cur.execute(SCHEMA_SQL)

    def write_tick(
        self,
        asset: str,
        ts: datetime,
        price: float,
        volume: float,
        regime: str,
        confidence: float,
        max_severity: float,
        partial_scores: dict,
    ):
        if not self.enabled:
            return

        regime_id = REGIME_TO_ID.get(regime, 0)
        escalation = _derive_escalation(regime, confidence)
        mult = MULT.get(regime, 10000)
        peg_dev_bps = max(0, int(abs(1.0 - _to_float(price)) * 10000))

        # Convert all numpy types to plain Python types
        clean_scores = {k: _to_float(v) for k, v in partial_scores.items()} if partial_scores else {}

        try:
            with self.conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO signal_ticks
                       (asset, ts, price, volume, regime, regime_id, confidence,
                        escalation, premium_mult, peg_dev_bps, max_severity, partial_scores)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (asset, ts, _to_float(price), _to_float(volume), regime,
                     regime_id, _to_float(confidence), escalation, mult,
                     peg_dev_bps, _to_float(max_severity), Json(clean_scores)),
                )
        except Exception as e:
            log.error(f"Failed to write tick: {e}")
            self._reconnect()

    def write_alert(
        self,
        asset: str,
        ts: datetime,
        signal_type: str,
        regime: str,
        prev_regime: Optional[str],
        confidence: float,
        price: float,
        max_severity: float,
        rule_fired: str = "",
        notes: str = "",
        tx_hash: Optional[str] = None,
    ):
        if not self.enabled:
            return

        try:
            with self.conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO signal_alerts
                       (asset, ts, signal_type, regime, prev_regime, confidence,
                        price, max_severity, rule_fired, notes, tx_hash)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (asset, ts, signal_type, regime, prev_regime,
                     _to_float(confidence), _to_float(price),
                     _to_float(max_severity), rule_fired, notes, tx_hash),
                )
        except Exception as e:
            log.error(f"Failed to write alert: {e}")
            self._reconnect()

    def _reconnect(self):
        try:
            db_url = os.environ.get("DATABASE_URL", "")
            if db_url:
                self.conn = psycopg2.connect(db_url)
                self.conn.autocommit = True
                log.info("Database reconnected")
        except Exception:
            self.enabled = False
            log.error("Database reconnect failed — persistence disabled")
