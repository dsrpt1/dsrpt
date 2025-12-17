// packages/web/src/app/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import NetworkStatus from '@/components/NetworkStatus';
import FundPoolModal from '@/components/FundPoolModal';
import CreatePolicyModal from '@/components/CreatePolicyModal';

export default function Page() {
  const { isConnected } = useAccount();
  const [fundPoolOpen, setFundPoolOpen] = useState(false);
  const [createPolicyOpen, setCreatePolicyOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState<string>('');

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
                <span className="market-value">$0</span>
                <span className="market-change neutral">No policies yet</span>
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
                <span className="market-value">$0</span>
                <span className="market-change neutral">Awaiting deposits</span>
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
                <span className="market-value">$1.00</span>
                <span className="market-change positive">Stable</span>
              </div>
            </div>
            <div className="market-card">
              <div className="market-icon amber">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
              </div>
              <div className="market-data">
                <span className="market-label">Risk Regime</span>
                <span className="market-value">CALM</span>
                <span className="market-change positive">Low volatility</span>
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
