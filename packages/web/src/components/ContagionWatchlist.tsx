'use client';

import { useReadContracts } from 'wagmi';
import { formatUnits } from 'viem';
import { CONTAGION, CONTAGION_PERILS } from '@/lib/addresses';
import {
  CONTAGION_REGISTRY_ABI,
  BACKING_RATIO_ORACLE_ABI,
  CONTAGION_TRIGGER_ABI,
} from '@/lib/abis';

const ORACLE = CONTAGION.base.oracle as `0x${string}`;
const REGISTRY = CONTAGION.base.registry as `0x${string}`;
const TRIGGER = CONTAGION.base.trigger as `0x${string}`;
const RSETH_PERIL = CONTAGION_PERILS.RSETH as `0x${string}`;

export default function ContagionWatchlist() {
  const { data } = useReadContracts({
    contracts: [
      {
        address: ORACLE,
        abi: BACKING_RATIO_ORACLE_ABI,
        functionName: 'getCurrentRatio',
        args: [RSETH_PERIL],
      },
      {
        address: REGISTRY,
        abi: CONTAGION_REGISTRY_ABI,
        functionName: 'getAggregateExposure',
        args: [RSETH_PERIL],
      },
      {
        address: TRIGGER,
        abi: CONTAGION_TRIGGER_ABI,
        functionName: 'isTriggered',
        args: [RSETH_PERIL],
      },
    ],
    query: { refetchInterval: 30_000 },
  });

  const ratio = data?.[0]?.result as readonly [number, boolean, number] | undefined;
  const exposure = data?.[1]?.result as readonly [bigint, bigint] | undefined;
  const isTriggered = data?.[2]?.result as boolean | undefined;

  const ratioBps = ratio?.[0] ?? 0;
  const breached = ratio?.[1] ?? false;
  const ratioDisplay = ratioBps > 0 ? `${(ratioBps / 100).toFixed(2)}%` : '--';
  const totalSupplyCap = exposure?.[0] ?? 0n;
  const exposureDisplay = totalSupplyCap > 0n
    ? `$${(Number(formatUnits(totalSupplyCap, 6)) / 1e6).toFixed(0)}M`
    : '--';

  const status = isTriggered ? 'TRIGGERED' : breached ? 'BREACHED' : ratioBps > 0 ? 'STABLE' : 'NO DATA';
  const statusClass = isTriggered ? 'critical' : breached ? 'critical' : ratioBps > 0 ? 'calm' : 'calm';
  const action = isTriggered ? 'Settle Policies' : breached ? 'Trigger Cascade' : 'Monitor';

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
            <th>Backing R</th>
            <th>Status</th>
            <th>Markets Exposure</th>
            <th>Recommended Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="wl-asset">rsETH</td>
            <td className="wl-mono">{ratioDisplay}</td>
            <td><span className={`strip-regime ${statusClass}`}>{status}</span></td>
            <td className="wl-mono">{exposureDisplay}</td>
            <td className="wl-action">{action}</td>
          </tr>
        </tbody>
      </table>
      <div className="confidence-note">
        Backing ratio R = (bridge reserves) / (wrapped tokens in circulation). When R drops below 95%, the contagion trigger fires atomically across all referencing lending markets (Aave V3, Morpho Blue). Coverage settles at the breach block.
      </div>
    </div>
  );
}
