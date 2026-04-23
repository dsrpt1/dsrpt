'use client';

import { useState, useEffect } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import Navigation from '@/components/Navigation';
import SignalPanel from '@/components/SignalPanel';
import ContagionPanel from '@/components/ContagionPanel';
import SignalChart from '@/components/SignalChart';
import CreatePolicyModal from '@/components/CreatePolicyModal';
import { ADDRESSES, PERIL_IDS } from '@/lib/addresses';
import { HAZARD_ENGINE_ABI, ORACLE_AGGREGATOR_ABI } from '@/lib/abis';

const REGIME_LABELS = ['CALM', 'VOLATILE', 'CRISIS'] as const;

export default function MonitorPage() {
  const { isConnected } = useAccount();
  const [currentTime, setCurrentTime] = useState<string>('');
  const [createPolicyOpen, setCreatePolicyOpen] = useState(false);

  const { data: currentRegime } = useReadContract({
    address: ADDRESSES.base.hazardEngine as `0x${string}`,
    abi: HAZARD_ENGINE_ABI,
    functionName: 'getCurrentRegime',
    args: [PERIL_IDS.USDC_DEPEG as `0x${string}`],
    query: { refetchInterval: 30_000 },
  });

  const { data: snapshotData } = useReadContract({
    address: ADDRESSES.base.oracleAggregator as `0x${string}`,
    abi: ORACLE_AGGREGATOR_ABI,
    functionName: 'getLatestSnapshot',
    args: [PERIL_IDS.USDC_DEPEG as `0x${string}`],
    query: { refetchInterval: 30_000 },
  });

  const regimeIndex = typeof currentRegime === 'number' ? currentRegime : 0;
  const regimeLabel = REGIME_LABELS[regimeIndex] ?? 'CALM';

  type Snapshot = { timestamp: number; medianPrice: bigint; minPrice: bigint; maxPrice: bigint; feedCount: number };
  const snapshot = snapshotData as Snapshot | undefined;
  const usdcPrice = snapshot?.medianPrice
    ? `$${Number(formatUnits(snapshot.medianPrice, 18)).toFixed(4)}`
    : '$--';

  useEffect(() => {
    const updateTime = () => {
      setCurrentTime(new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <main className="command-center">
      {/* Top Bar */}
      <header className="top-bar">
        <div className="logo-section">
          <div className="logo-mark">
            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M16 2L4 8v16l12 6 12-6V8L16 2z" stroke="url(#logo-gradient)" strokeWidth="2" fill="none"/>
              <path d="M16 8l-6 3v10l6 3 6-3V11l-6-3z" fill="url(#logo-gradient)" opacity="0.3"/>
              <circle cx="16" cy="16" r="4" fill="url(#logo-gradient)"/>
              <defs><linearGradient id="logo-gradient" x1="0" y1="0" x2="32" y2="32"><stop stopColor="#00d4ff"/><stop offset="1" stopColor="#a855f7"/></linearGradient></defs>
            </svg>
          </div>
          <div className="logo-text">
            <span className="logo-name">DSRPT</span>
            <span className="logo-tagline">Monitor</span>
          </div>
        </div>

        <Navigation />

        <div className="status-bar">
          <div className="status-item">
            <span className="status-label">ENGINE</span>
            <span className="status-value live"><span className="pulse-dot"></span>LIVE</span>
          </div>
          <div className="status-item">
            <span className="status-label">REGIME</span>
            <span className={`status-value ${regimeIndex === 0 ? 'live' : 'mono'}`}>{regimeLabel}</span>
          </div>
          <div className="status-item">
            <span className="status-label">USDC</span>
            <span className="status-value mono">{usdcPrice}</span>
          </div>
          <div className="status-item">
            <span className="status-label">UTC</span>
            <span className="status-value mono">{currentTime}</span>
          </div>
        </div>

        <ConnectButton />
      </header>

      {/* Signal Panel + Contagion Panel + Charts */}
      <div className="dashboard-grid" style={{ gridTemplateColumns: '340px 1fr' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SignalPanel />
          <ContagionPanel />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SignalChart symbol="USDC" />
          <SignalChart symbol="USDT" />
          <SignalChart symbol="DAI" />
        </div>
      </div>

      {/* Risk Products — below signal intelligence */}
      <section className="panel" style={{ marginTop: 0 }}>
        <div className="panel-header">
          <h2>Risk Products</h2>
          <span className="panel-badge" style={{ background: 'rgba(168, 85, 247, 0.2)', color: '#a855f7' }}>PILOT</span>
        </div>
        <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {/* Buy Protection */}
          <button
            className={`action-card ${isConnected ? 'active' : 'disabled'}`}
            onClick={() => setCreatePolicyOpen(true)}
            disabled={!isConnected}
            style={{ textAlign: 'left', cursor: isConnected ? 'pointer' : 'default' }}
          >
            <div className="action-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <path d="M9 12l2 2 4-4"/>
              </svg>
            </div>
            <div className="action-content">
              <span className="action-title">Buy Depeg Protection</span>
              <span className="action-desc">
                {isConnected
                  ? 'USDC coverage — premium calculated from live hazard curve and current regime'
                  : 'Connect wallet to access risk products'}
              </span>
            </div>
            <div className="action-arrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </div>
          </button>

          {/* Coverage info */}
          <div style={{
            padding: '20px',
            background: 'rgba(0,0,0,0.15)',
            borderRadius: 12,
            border: '1px solid var(--border-subtle)',
          }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
              Coverage Parameters
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Depeg Cover</span>
                <span style={{ color: 'var(--text-primary)' }}>USDC, USDT</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Contagion Cover</span>
                <span style={{ color: 'var(--text-primary)' }}>rsETH (Aave, Morpho)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Depeg Trigger</span>
                <span style={{ color: 'var(--text-primary)' }}>&lt; $0.98</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Contagion Trigger</span>
                <span style={{ color: 'var(--text-primary)' }}>R &lt; 95% backing</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Tranches</span>
                <span style={{ color: 'var(--text-primary)' }}>Senior / Mezz / Cat</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Settlement</span>
                <span style={{ color: 'var(--text-primary)' }}>Parametric (automatic)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Oracle</span>
                <span style={{ color: 'var(--text-primary)' }}>Chainlink + Signal Engine</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="stats-bar">
        <div className="stat-item">
          <span className="stat-label">Signal Engine</span>
          <span className="stat-value">v2 (classifier_v2)</span>
        </div>
        <div className="stat-divider"></div>
        <div className="stat-item">
          <span className="stat-label">Poll Interval</span>
          <span className="stat-value">15 min</span>
        </div>
        <div className="stat-divider"></div>
        <div className="stat-item">
          <span className="stat-label">Chain</span>
          <span className="stat-value">Base Mainnet</span>
        </div>
        <div className="stat-divider"></div>
        <div className="stat-item">
          <span className="stat-label">OracleAdapter</span>
          <span className="stat-value">0x0f43...9524</span>
        </div>
      </footer>

      {/* Policy Modal */}
      <CreatePolicyModal isOpen={createPolicyOpen} onClose={() => setCreatePolicyOpen(false)} />
    </main>
  );
}
