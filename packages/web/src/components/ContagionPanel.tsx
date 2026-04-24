'use client';

import { useState } from 'react';
import { useReadContracts } from 'wagmi';
import { formatUnits } from 'viem';
import { CONTAGION, CONTAGION_ASSETS } from '@/lib/addresses';
import {
  CONTAGION_REGISTRY_ABI,
  BACKING_RATIO_ORACLE_ABI,
  CONTAGION_TRIGGER_ABI,
  CONTAGION_PRICING_ABI,
} from '@/lib/abis';

const REGISTRY = CONTAGION.base.registry as `0x${string}`;
const ORACLE = CONTAGION.base.oracle as `0x${string}`;
const TRIGGER = CONTAGION.base.trigger as `0x${string}`;
const PRICING = CONTAGION.base.pricingEngine as `0x${string}`;

type Listing = {
  market: `0x${string}`;
  marketName: string;
  ltvBps: number;
  supplyCap: bigint;
  active: boolean;
};

export default function ContagionPanel() {
  const [selected, setSelected] = useState<string>(CONTAGION_ASSETS[0].symbol);
  const asset = CONTAGION_ASSETS.find(a => a.symbol === selected) ?? CONTAGION_ASSETS[0];
  const perilId = asset.perilId as `0x${string}`;

  const { data, isLoading } = useReadContracts({
    contracts: [
      { address: ORACLE, abi: BACKING_RATIO_ORACLE_ABI, functionName: 'getCurrentRatio', args: [perilId] },
      { address: ORACLE, abi: BACKING_RATIO_ORACLE_ABI, functionName: 'getDilutionDepth', args: [perilId] },
      { address: REGISTRY, abi: CONTAGION_REGISTRY_ABI, functionName: 'getAggregateExposure', args: [perilId] },
      { address: REGISTRY, abi: CONTAGION_REGISTRY_ABI, functionName: 'getActiveListings', args: [perilId] },
      { address: REGISTRY, abi: CONTAGION_REGISTRY_ABI, functionName: 'getVerifierPenalty', args: [perilId] },
      { address: TRIGGER, abi: CONTAGION_TRIGGER_ABI, functionName: 'isTriggered', args: [perilId] },
      { address: TRIGGER, abi: CONTAGION_TRIGGER_ABI, functionName: 'estimateTotalPayout', args: [perilId] },
      { address: PRICING, abi: CONTAGION_PRICING_ABI, functionName: 'getContagionMultiplier', args: [perilId] },
    ],
    query: { refetchInterval: 30_000 },
  });

  const ratio = data?.[0]?.result as readonly [number, boolean, number] | undefined;
  const dilution = data?.[1]?.result as number | undefined;
  const exposure = data?.[2]?.result as readonly [bigint, bigint] | undefined;
  const listings = data?.[3]?.result as readonly [readonly Listing[], bigint] | undefined;
  const verifierPenalty = data?.[4]?.result as number | undefined;
  const isTriggered = data?.[5]?.result as boolean | undefined;
  const estimatedPayout = data?.[6]?.result as bigint | undefined;
  const contagionMultiplier = data?.[7]?.result as bigint | undefined;

  const ratioBps = ratio?.[0] ?? 0;
  const breached = ratio?.[1] ?? false;
  const ratioPct = (ratioBps / 100).toFixed(2);
  const dilutionPct = ((dilution ?? 0) / 100).toFixed(2);
  const totalSupplyCap = exposure?.[0] ?? 0n;
  const weightedLtv = exposure?.[1] ?? 0n;
  const cm = contagionMultiplier ? Number(contagionMultiplier) / 100 : 0;
  const verifierPct = verifierPenalty ? (verifierPenalty / 100).toFixed(0) : '--';

  const statusLabel = breached ? 'BREACHED' : 'STABLE';
  const statusColor = breached ? '#ef4444' : '#22c55e';
  const triggerLabel = isTriggered ? 'CASCADE FIRED' : 'ARMED';
  const triggerColor = isTriggered ? '#ef4444' : '#3b82f6';

  return (
    <section className="panel contagion-panel">
      <div className="panel-header">
        <h2>Contagion Cover</h2>
        <span className="panel-badge" style={{ background: statusColor }}>{statusLabel}</span>
      </div>

      {/* Asset selector */}
      <div className="contagion-asset-selector">
        {CONTAGION_ASSETS.map(a => (
          <button
            key={a.symbol}
            onClick={() => setSelected(a.symbol)}
            className={`asset-tab ${selected === a.symbol ? 'active' : ''}`}
          >
            {a.symbol}
          </button>
        ))}
      </div>

      <div className="contagion-grid">
        {/* Asset header */}
        <div className="contagion-asset-row">
          <span className="contagion-asset">{asset.symbol}</span>
          <span className="contagion-asset-source">{asset.source} · {asset.verifiers}</span>
        </div>

        <div className="signal-divider" />

        <div className="signal-row">
          <span className="signal-label">Backing Ratio (R)</span>
          <span className="signal-value mono" style={{ color: breached ? '#ef4444' : '#22c55e', fontWeight: 700 }}>
            {isLoading ? '--' : `${ratioPct}%`}
          </span>
        </div>

        <div className="signal-row">
          <span className="signal-label">Dilution Depth</span>
          <span className="signal-value mono">{isLoading ? '--' : `${dilutionPct}%`}</span>
        </div>

        <div className="signal-row">
          <span className="signal-label">Trigger</span>
          <span className="signal-status" style={{ color: triggerColor, background: `${triggerColor}1a`, border: `1px solid ${triggerColor}33` }}>
            {triggerLabel}
          </span>
        </div>

        <div className="signal-divider" />

        <div className="signal-row">
          <span className="signal-label">Affected Markets</span>
          <span className="signal-value mono">{listings?.[1]?.toString() ?? '0'}</span>
        </div>

        <div className="signal-row">
          <span className="signal-label">Total Supply Cap</span>
          <span className="signal-value mono">
            ${totalSupplyCap > 0n ? `${(Number(formatUnits(totalSupplyCap, 6)) / 1e6).toFixed(0)}M` : '0'}
          </span>
        </div>

        <div className="signal-row">
          <span className="signal-label">LTV Notional</span>
          <span className="signal-value mono">
            ${weightedLtv > 0n ? `${(Number(formatUnits(weightedLtv, 6)) / 1e6).toFixed(0)}M` : '0'}
          </span>
        </div>

        <div className="signal-row">
          <span className="signal-label">Contagion Multiplier</span>
          <span className="signal-value mono" style={{ color: '#a855f7' }}>{cm.toFixed(1)}x</span>
        </div>

        <div className="signal-row">
          <span className="signal-label">Verifier Penalty</span>
          <span className="signal-value mono">{verifierPct}%</span>
        </div>

        {(estimatedPayout ?? 0n) > 0n && (
          <>
            <div className="signal-divider" />
            <div className="signal-row">
              <span className="signal-label">Est. Total Payout</span>
              <span className="signal-value mono" style={{ color: '#ef4444', fontWeight: 700 }}>
                ${(Number(formatUnits(estimatedPayout!, 6)) / 1e6).toFixed(2)}M
              </span>
            </div>
          </>
        )}

        {listings && listings[0] && listings[0].length > 0 && (
          <>
            <div className="signal-divider" />
            <div style={{ padding: '0 20px' }}>
              <div className="contagion-listings-header">Lending Markets</div>
              {listings[0].map((l, i) => (
                <div key={i} className="contagion-listing">
                  <span>{l.marketName}</span>
                  <span className="contagion-listing-meta">
                    {(l.ltvBps / 100).toFixed(0)}% LTV · ${(Number(formatUnits(l.supplyCap, 6)) / 1e6).toFixed(0)}M cap
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="signal-footer">
        <span className="signal-source">Source: BackingRatioOracle on-chain</span>
        <a
          href={`https://basescan.org/address/${REGISTRY}`}
          target="_blank"
          rel="noopener noreferrer"
          className="signal-link"
        >
          View on BaseScan
        </a>
      </div>

      <style jsx>{`
        .contagion-panel {
          grid-column: span 1;
        }
        .contagion-asset-selector {
          display: flex;
          gap: 4px;
          padding: 12px 20px 0;
          flex-wrap: wrap;
        }
        .asset-tab {
          padding: 5px 10px;
          font-size: 11px;
          font-weight: 600;
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          background: transparent;
          color: var(--text-secondary);
          cursor: pointer;
          transition: all 0.2s;
        }
        .asset-tab:hover {
          border-color: rgba(0, 212, 255, 0.3);
          color: var(--text-primary);
        }
        .asset-tab.active {
          background: rgba(0, 212, 255, 0.1);
          border-color: rgba(0, 212, 255, 0.3);
          color: #00d4ff;
        }
        .contagion-grid {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 16px 0;
        }
        .contagion-asset-row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          padding: 0 20px;
        }
        .contagion-asset {
          font-size: 22px;
          font-weight: 700;
          color: #e5e7eb;
          letter-spacing: -0.02em;
        }
        .contagion-asset-source {
          font-size: 11px;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .contagion-listings-header {
          font-size: 11px;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 8px;
        }
        .contagion-listing {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 6px 0;
          font-size: 12px;
          color: #d1d5db;
        }
        .contagion-listing-meta {
          font-family: 'SF Mono', 'Fira Code', monospace;
          font-size: 11px;
          color: #9ca3af;
        }
      `}</style>
    </section>
  );
}
