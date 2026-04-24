'use client';

import { useReadContracts } from 'wagmi';
import { formatUnits } from 'viem';
import { CONTAGION, CONTAGION_ASSETS } from '@/lib/addresses';
import {
  CONTAGION_REGISTRY_ABI,
  BACKING_RATIO_ORACLE_ABI,
  CONTAGION_TRIGGER_ABI,
} from '@/lib/abis';

const ORACLE = CONTAGION.base.oracle as `0x${string}`;
const REGISTRY = CONTAGION.base.registry as `0x${string}`;
const TRIGGER = CONTAGION.base.trigger as `0x${string}`;

export default function ContagionWatchlist() {
  // Build one batch of contracts reads — 3 reads per asset
  const contracts = CONTAGION_ASSETS.flatMap(a => [
    {
      address: ORACLE,
      abi: BACKING_RATIO_ORACLE_ABI,
      functionName: 'getCurrentRatio' as const,
      args: [a.perilId as `0x${string}`] as const,
    },
    {
      address: REGISTRY,
      abi: CONTAGION_REGISTRY_ABI,
      functionName: 'getAggregateExposure' as const,
      args: [a.perilId as `0x${string}`] as const,
    },
    {
      address: TRIGGER,
      abi: CONTAGION_TRIGGER_ABI,
      functionName: 'isTriggered' as const,
      args: [a.perilId as `0x${string}`] as const,
    },
  ]);

  const { data } = useReadContracts({
    contracts,
    query: { refetchInterval: 30_000 },
  });

  const rows = CONTAGION_ASSETS.map((asset, i) => {
    const base = i * 3;
    const ratio = data?.[base]?.result as readonly [number, boolean, number] | undefined;
    const exposure = data?.[base + 1]?.result as readonly [bigint, bigint] | undefined;
    const isTriggered = data?.[base + 2]?.result as boolean | undefined;

    const ratioBps = ratio?.[0] ?? 0;
    const breached = ratio?.[1] ?? false;
    const totalSupplyCap = exposure?.[0] ?? 0n;

    const ratioDisplay = ratioBps > 0 ? `${(ratioBps / 100).toFixed(2)}%` : '--';
    const exposureDisplay = totalSupplyCap > 0n
      ? `$${(Number(formatUnits(totalSupplyCap, 6)) / 1e6).toFixed(0)}M`
      : '--';

    const status = isTriggered ? 'TRIGGERED' : breached ? 'BREACHED' : ratioBps > 0 ? 'STABLE' : 'NO DATA';
    const statusClass = isTriggered || breached ? 'critical' : 'calm';
    const action = isTriggered ? 'Settle Policies' : breached ? 'Trigger Cascade' : 'Monitor';

    return {
      asset: asset.symbol,
      source: asset.source,
      verifiers: asset.verifiers,
      ratio: ratioDisplay,
      status,
      statusClass,
      exposure: exposureDisplay,
      action,
    };
  });

  return (
    <div className="watchlist-table-wrap" style={{ marginTop: 24 }}>
      <div style={{ marginBottom: 12, padding: '0 4px' }}>
        <h3 style={{ fontSize: 14, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
          Wrapped Asset Backing — Contagion Coverage
        </h3>
      </div>
      <table className="watchlist-table">
        <thead>
          <tr>
            <th>Asset</th>
            <th>Source</th>
            <th>Verifiers</th>
            <th>Backing R</th>
            <th>Status</th>
            <th>Exposure</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.asset}>
              <td className="wl-asset">{r.asset}</td>
              <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.source}</td>
              <td className="wl-mono" style={{ fontSize: 12 }}>{r.verifiers}</td>
              <td className="wl-mono">{r.ratio}</td>
              <td><span className={`strip-regime ${r.statusClass}`}>{r.status}</span></td>
              <td className="wl-mono">{r.exposure}</td>
              <td className="wl-action">{r.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="confidence-note">
        Backing ratio R = (bridge reserves) / (wrapped tokens in circulation). When R drops below 95%, the contagion trigger fires atomically across all referencing lending markets. Coverage settles at the breach block. Verifier cardinality drives the moral hazard premium — 1-of-1 (centralized) pays ~3x more than 5-of-5 (decentralized) at the same LTV.
      </div>
    </div>
  );
}
