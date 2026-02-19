// packages/web/src/app/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import NetworkStatus from '@/components/NetworkStatus';
import FundPoolModal from '@/components/FundPoolModal';
import CreatePolicyModal from '@/components/CreatePolicyModal';
import Navigation from '@/components/Navigation';
import { ADDRESSES, PERIL_IDS } from '@/lib/addresses';
import { TREASURY_MANAGER_ABI, HAZARD_ENGINE_ABI, ORACLE_AGGREGATOR_ABI } from '@/lib/abis';

const REGIME_LABELS = ['CALM', 'VOLATILE', 'CRISIS'] as const;
const REGIME_CLASSES = ['positive', 'amber', 'negative'] as const;
const REGIME_DESCRIPTIONS = ['Low volatility', 'Elevated risk', 'Active depeg'] as const;

export default function Page() {
  const { isConnected } = useAccount();
  const [fundPoolOpen, setFundPoolOpen] = useState(false);
  const [createPolicyOpen, setCreatePolicyOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState<string>('');

  // Read pool stats from TreasuryManager (returns totalAssets, totalLiabilities, availableCapital)
  const { data: poolStats } = useReadContract({
    address: ADDRESSES.base.treasuryManager as `0x${string}`,
    abi: TREASURY_MANAGER_ABI,
    functionName: 'getPoolStats',
    query: { refetchInterval: 30_000 },
  });

  // Read current risk regime from HazardEngine
  const { data: currentRegime } = useReadContract({
    address: ADDRESSES.base.hazardEngine as `0x${string}`,
    abi: HAZARD_ENGINE_ABI,
    functionName: 'getCurrentRegime',
    args: [PERIL_IDS.USDC_DEPEG as `0x${string}`],
    query: { refetchInterval: 30_000 },
  });

  // Read latest snapshot from OracleAggregator
  const { data: snapshotData } = useReadContract({
    address: ADDRESSES.base.oracleAggregator as `0x${string}`,
    abi: ORACLE_AGGREGATOR_ABI,
    functionName: 'getLatestSnapshot',
    args: [PERIL_IDS.USDC_DEPEG as `0x${string}`],
    query: { refetchInterval: 30_000 },
  });

  // Format values from poolStats tuple [totalAssets, totalLiabilities, availableCapital]
  const totalAssets = poolStats ? (poolStats as [bigint, bigint, bigint])[0] : null;
  const totalLiabilities = poolStats ? (poolStats as [bigint, bigint, bigint])[1] : null;
  const availableCapital = poolStats ? (poolStats as [bigint, bigint, bigint])[2] : null;

  const poolLiquidity = totalAssets
    ? `$${Number(formatUnits(totalAssets, 6)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '$—';
  const poolCapacity = availableCapital
    ? `$${Number(formatUnits(availableCapital, 6)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} available`
    : 'Loading...';

  const regimeIndex = typeof currentRegime === 'number' ? currentRegime : 0;
  const regimeLabel = REGIME_LABELS[regimeIndex] ?? 'CALM';
  const regimeClass = REGIME_CLASSES[regimeIndex] ?? 'positive';
  const regimeDesc = REGIME_DESCRIPTIONS[regimeIndex] ?? 'Low volatility';

  // Price comes from snapshot.medianPrice (18 decimals normalized)
  type Snapshot = { timestamp: number; medianPrice: bigint; minPrice: bigint; maxPrice: bigint; feedCount: number };
  const snapshot = snapshotData as Snapshot | undefined;
  const usdcPrice = snapshot?.medianPrice
    ? `$${Number(formatUnits(snapshot.medianPrice, 18)).toFixed(4)}`
    : '$—';
  const priceStable = snapshot?.medianPrice
    ? Number(formatUnits(snapshot.medianPrice, 18)) >= 0.98
    : true;

  // Active coverage = totalLiabilities (policies being covered)
  const activeCoverage = totalLiabilities
    ? `$${Number(formatUnits(totalLiabilities, 6)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '$—';

  useEffect(() => {
    const updateTime = () => {
      setCurrentTime(new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }));
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
              <defs>
                <linearGradient id="logo-gradient" x1="0" y1="0" x2="32" y2="32">
                  <stop stopColor="#00d4ff"/>
                  <stop offset="1" stopColor="#a855f7"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div className="logo-text">
            <span className="logo-name">DSRPT</span>
            <span className="logo-tagline">Parametric Risk Market</span>
          </div>
        </div>

        <Navigation />

        <div className="status-bar">
          <div className="status-item">
            <span className="status-label">NETWORK</span>
            <span className="status-value live">
              <span className="pulse-dot"></span>
              BASE
            </span>
          </div>
          <div className="status-item">
            <span className="status-label">UTC</span>
            <span className="status-value mono">{currentTime}</span>
          </div>
          <div className="status-item">
            <span className="status-label">STATUS</span>
            <span className="status-value live">
              <span className="pulse-dot"></span>
              OPERATIONAL
            </span>
          </div>
        </div>

        <ConnectButton />
      </header>

      {/* Main Dashboard Grid */}
      <div className="dashboard-grid">
        {/* Left Panel - Market Overview */}
        <section className="panel market-panel">
          <div className="panel-header">
            <h2>Market Overview</h2>
            <span className="panel-badge">LIVE</span>
          </div>
          <div className="market-grid">
            <div className="market-card primary">
              <div className="market-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 6v6l4 2"/>
                </svg>
              </div>
              <div className="market-data">
                <span className="market-label">Active Coverage</span>
                <span className="market-value">{activeCoverage}</span>
                <span className="market-change neutral">Committed capital</span>
              </div>
            </div>
            <div className="market-card">
              <div className="market-icon purple">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                  <path d="M2 17l10 5 10-5"/>
                  <path d="M2 12l10 5 10-5"/>
                </svg>
              </div>
              <div className="market-data">
                <span className="market-label">Pool Liquidity</span>
                <span className="market-value">{poolLiquidity}</span>
                <span className="market-change neutral">{poolCapacity}</span>
              </div>
            </div>
            <div className="market-card">
              <div className="market-icon green">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                </svg>
              </div>
              <div className="market-data">
                <span className="market-label">USDC Price</span>
                <span className="market-value">{usdcPrice}</span>
                <span className={`market-change ${priceStable ? 'positive' : 'negative'}`}>
                  {priceStable ? 'Stable' : 'Depeg detected'}
                </span>
              </div>
            </div>
            <div className="market-card">
              <div className={`market-icon ${regimeIndex === 0 ? 'green' : regimeIndex === 1 ? 'amber' : 'red'}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
              </div>
              <div className="market-data">
                <span className="market-label">Risk Regime</span>
                <span className="market-value">{regimeLabel}</span>
                <span className={`market-change ${regimeClass}`}>{regimeDesc}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Center Panel - Network Status */}
        <section className="panel center-panel">
          <NetworkStatus />
        </section>

        {/* Right Panel - Actions */}
        <section className="panel actions-panel">
          <div className="panel-header">
            <h2>Trading Terminal</h2>
          </div>
          <div className="actions-grid">
            <button
              className={`action-card ${isConnected ? 'active' : 'disabled'}`}
              onClick={() => setCreatePolicyOpen(true)}
              disabled={!isConnected}
            >
              <div className="action-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  <path d="M9 12l2 2 4-4"/>
                </svg>
              </div>
              <div className="action-content">
                <span className="action-title">Buy Protection</span>
                <span className="action-desc">
                  {isConnected ? 'Hedge against USDC depeg risk' : 'Connect wallet to trade'}
                </span>
              </div>
              <div className="action-arrow">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </div>
            </button>

            <button
              className={`action-card secondary ${isConnected ? 'active' : 'disabled'}`}
              onClick={() => setFundPoolOpen(true)}
              disabled={!isConnected}
            >
              <div className="action-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <path d="M12 8v8M8 12h8"/>
                </svg>
              </div>
              <div className="action-content">
                <span className="action-title">Provide Liquidity</span>
                <span className="action-desc">
                  {isConnected ? 'Earn yield by underwriting risk' : 'Connect wallet to trade'}
                </span>
              </div>
              <div className="action-arrow">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </div>
            </button>
          </div>

          {/* Risk Parameters */}
          <div className="params-section">
            <div className="panel-header small">
              <h3>Risk Parameters</h3>
            </div>
            <div className="params-grid">
              <div className="param-item">
                <span className="param-label">Trigger Price</span>
                <span className="param-value">&lt; $0.98</span>
              </div>
              <div className="param-item">
                <span className="param-label">Min Premium</span>
                <span className="param-value">0.25%</span>
              </div>
              <div className="param-item">
                <span className="param-label">Oracle</span>
                <span className="param-value">Chainlink</span>
              </div>
              <div className="param-item">
                <span className="param-label">Settlement</span>
                <span className="param-value">Instant</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Bottom Stats Bar */}
      <footer className="stats-bar">
        <div className="stat-item">
          <span className="stat-label">Protocol Version</span>
          <span className="stat-value">v1.0.0</span>
        </div>
        <div className="stat-divider"></div>
        <div className="stat-item">
          <span className="stat-label">Contracts</span>
          <span className="stat-value">5 Deployed</span>
        </div>
        <div className="stat-divider"></div>
        <div className="stat-item">
          <span className="stat-label">Chain</span>
          <span className="stat-value">Base Mainnet (8453)</span>
        </div>
        <div className="stat-divider"></div>
        <div className="stat-item">
          <span className="stat-label">Audited</span>
          <span className="stat-value pending">Pending</span>
        </div>
      </footer>

      {/* Modals */}
      <FundPoolModal isOpen={fundPoolOpen} onClose={() => setFundPoolOpen(false)} />
      <CreatePolicyModal isOpen={createPolicyOpen} onClose={() => setCreatePolicyOpen(false)} />
    </main>
  );
}
