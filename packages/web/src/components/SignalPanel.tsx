'use client';

import { useState, useEffect } from 'react';
import { useReadContract } from 'wagmi';
import { ADDRESSES } from '@/lib/addresses';
import { ORACLE_ADAPTER_ABI } from '@/lib/abis';

const USDC = ADDRESSES.base.usdc as `0x${string}`;
const ADAPTER = ADDRESSES.base.oracleAdapter as `0x${string}`;

const SIGNAL_REGIMES: Record<string, { label: string; color: string }> = {
  'ambiguous':             { label: 'AMBIGUOUS',             color: '#6b7280' },
  'contained_stress':      { label: 'CONTAINED STRESS',      color: '#3b82f6' },
  'liquidity_dislocation': { label: 'LIQUIDITY DISLOCATION', color: '#f59e0b' },
  'collateral_shock':      { label: 'COLLATERAL SHOCK',      color: '#f97316' },
  'reflexive_collapse':    { label: 'REFLEXIVE COLLAPSE',    color: '#ef4444' },
};

const ESCALATION_LABELS = ['NORMAL', 'ELEVATED', 'ESCALATING', 'CRITICAL'] as const;
const ESCALATION_COLORS = ['#22c55e', '#f59e0b', '#f97316', '#ef4444'] as const;

type MarketAsset = {
  asset: string;
  regime: string;
  regime_id: number;
  confidence: number;
  escalation: number;
  premium_multiplier_bps: number;
  peg_dev_bps: number;
  price: number;
  updated_at: string;
};

type MarketData = {
  composite_regime: string;
  assets: MarketAsset[];
  updated_at: string;
};

export default function SignalPanel() {
  const [market, setMarket] = useState<MarketData | null>(null);

  // Fetch live data from Postgres-backed API
  useEffect(() => {
    const fetchData = () => {
      fetch('/api/v1/signals/market')
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data?.assets) setMarket(data); })
        .catch(() => {});
    };
    fetchData();
    const interval = setInterval(fetchData, 15_000);
    return () => clearInterval(interval);
  }, []);

  // On-chain gates (these must come from the contract)
  const { data: issuanceAllowed } = useReadContract({
    address: ADAPTER,
    abi: ORACLE_ADAPTER_ABI,
    functionName: 'isPolicyIssuanceAllowed',
    args: [USDC],
    query: { refetchInterval: 15_000 },
  });

  const { data: withdrawalAllowed } = useReadContract({
    address: ADAPTER,
    abi: ORACLE_ADAPTER_ABI,
    functionName: 'isWithdrawalAllowed',
    args: [USDC],
    query: { refetchInterval: 15_000 },
  });

  const { data: lockupTime } = useReadContract({
    address: ADAPTER,
    abi: ORACLE_ADAPTER_ABI,
    functionName: 'timeUntilWithdrawalUnlock',
    args: [USDC],
    query: { refetchInterval: 15_000 },
  });

  // Use USDC as primary display asset
  const usdc = market?.assets?.find(a => a.asset === 'USDC');
  const regime = usdc?.regime || 'ambiguous';
  const regimeInfo = SIGNAL_REGIMES[regime] || SIGNAL_REGIMES['ambiguous'];
  const confidence = usdc?.confidence ?? 0;
  const confidencePct = (confidence * 100).toFixed(1);
  const escalationIndex = usdc?.escalation ?? 0;
  const multBps = usdc?.premium_multiplier_bps ?? 10000;
  const multDisplay = (multBps / 10000).toFixed(2);
  const lockupSeconds = lockupTime ? Number(lockupTime) : 0;
  const lockupHours = Math.ceil(lockupSeconds / 3600);
  const lastUpdate = market?.updated_at
    ? new Date(market.updated_at).toLocaleTimeString('en-US', { hour12: false })
    : '--:--';

  const escLabel = ESCALATION_LABELS[escalationIndex] ?? 'NORMAL';
  const escColor = ESCALATION_COLORS[escalationIndex] ?? '#22c55e';

  return (
    <section className="panel signal-panel">
      <div className="panel-header">
        <h2>Signal Engine</h2>
        <span className="panel-badge" style={{ background: regimeInfo.color }}>{regimeInfo.label}</span>
      </div>

      <div className="signal-grid">
        {/* Per-asset regime summary */}
        {market?.assets && market.assets.length > 0 && (
          <>
            {market.assets.map(a => {
              const info = SIGNAL_REGIMES[a.regime] || SIGNAL_REGIMES['ambiguous'];
              const conf = (a.confidence * 100).toFixed(0);
              return (
                <div key={a.asset} className="signal-row">
                  <span className="signal-label">{a.asset}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: info.color, fontWeight: 600, fontSize: 12 }}>{info.label}</span>
                    <span className="signal-value mono" style={{ fontSize: 12, color: '#9ca3af' }}>{conf}%</span>
                  </div>
                </div>
              );
            })}
            <div className="signal-divider" />
          </>
        )}

        {/* Confidence (USDC primary) */}
        <div className="signal-row">
          <span className="signal-label">USDC Confidence</span>
          <div className="signal-bar-container">
            <div className="signal-bar" style={{ width: `${confidencePct}%`, background: regimeInfo.color }} />
            <span className="signal-bar-label">{confidencePct}%</span>
          </div>
        </div>

        {/* Escalation */}
        <div className="signal-row">
          <span className="signal-label">Escalation</span>
          <span className="signal-value" style={{ color: escColor }}>
            {escLabel}
          </span>
        </div>

        {/* Premium Loading */}
        <div className="signal-row">
          <span className="signal-label">Premium Loading</span>
          <span className="signal-value mono">{multDisplay}x</span>
        </div>

        <div className="signal-divider" />

        {/* Issuance Gate */}
        <div className="signal-row">
          <span className="signal-label">Policy Issuance</span>
          <span className={`signal-status ${issuanceAllowed ? 'open' : 'blocked'}`}>
            {issuanceAllowed ? 'OPEN' : 'BLOCKED'}
          </span>
        </div>

        {/* LP Withdrawal */}
        <div className="signal-row">
          <span className="signal-label">LP Withdrawals</span>
          <span className={`signal-status ${withdrawalAllowed ? 'open' : 'blocked'}`}>
            {withdrawalAllowed ? 'OPEN' : `LOCKED (${lockupHours}h)`}
          </span>
        </div>

        <div className="signal-divider" />

        {/* Last Update */}
        <div className="signal-row">
          <span className="signal-label">Last Update</span>
          <span className="signal-value mono">{lastUpdate} UTC</span>
        </div>
      </div>

      <div className="signal-footer">
        <span className="signal-source">
          Source: classifier_v2 via Postgres
        </span>
        <a
          href={`https://basescan.org/address/${ADAPTER}`}
          target="_blank"
          rel="noopener noreferrer"
          className="signal-link"
        >
          View on BaseScan
        </a>
      </div>

      <style jsx>{`
        .signal-panel {
          grid-column: span 1;
        }
        .signal-grid {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 16px 0;
        }
        .signal-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0 20px;
        }
        .signal-label {
          font-size: 13px;
          color: #9ca3af;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .signal-value {
          font-size: 14px;
          color: #e5e7eb;
        }
        .signal-value.mono {
          font-family: 'SF Mono', 'Fira Code', monospace;
        }
        .signal-bar-container {
          position: relative;
          width: 140px;
          height: 20px;
          background: rgba(255,255,255,0.05);
          border-radius: 4px;
          overflow: hidden;
        }
        .signal-bar {
          height: 100%;
          border-radius: 4px;
          transition: width 0.5s ease;
        }
        .signal-bar-label {
          position: absolute;
          right: 6px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 11px;
          color: #fff;
          font-weight: 600;
        }
        .signal-divider {
          height: 1px;
          background: rgba(255,255,255,0.06);
          margin: 4px 20px;
        }
        .signal-status {
          font-size: 12px;
          font-weight: 700;
          padding: 2px 10px;
          border-radius: 4px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .signal-status.open {
          color: #22c55e;
          background: rgba(34,197,94,0.1);
          border: 1px solid rgba(34,197,94,0.2);
        }
        .signal-status.blocked {
          color: #ef4444;
          background: rgba(239,68,68,0.1);
          border: 1px solid rgba(239,68,68,0.2);
        }
        .signal-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 20px 0;
          border-top: 1px solid rgba(255,255,255,0.06);
          margin-top: 8px;
        }
        .signal-source {
          font-size: 11px;
          color: #6b7280;
        }
        .signal-link {
          font-size: 11px;
          color: #3b82f6;
          text-decoration: none;
        }
        .signal-link:hover {
          text-decoration: underline;
        }
      `}</style>
    </section>
  );
}
