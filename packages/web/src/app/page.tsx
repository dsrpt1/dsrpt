'use client';

import Link from 'next/link';
import Navigation from '@/components/Navigation';
import { ConnectButton } from '@rainbow-me/rainbowkit';

export default function HomePage() {
  return (
    <main className="landing-page">
      {/* Top Bar */}
      <header className="top-bar">
        <div className="logo-section">
          <div className="logo-mark">
            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M16 2L4 8v16l12 6 12-6V8L16 2z" stroke="url(#lg)" strokeWidth="2" fill="none"/>
              <path d="M16 8l-6 3v10l6 3 6-3V11l-6-3z" fill="url(#lg)" opacity="0.3"/>
              <circle cx="16" cy="16" r="4" fill="url(#lg)"/>
              <defs>
                <linearGradient id="lg" x1="0" y1="0" x2="32" y2="32">
                  <stop stopColor="#00d4ff"/><stop offset="1" stopColor="#a855f7"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div className="logo-text">
            <span className="logo-name">DSRPT</span>
            <span className="logo-tagline">Risk Intelligence</span>
          </div>
        </div>
        <Navigation />
        <ConnectButton />
      </header>

      {/* Hero */}
      <section className="hero">
        <div className="hero-content">
          <div className="hero-badge">Live on Base Mainnet</div>
          <h1>Real-time stablecoin and crypto stress intelligence</h1>
          <p className="hero-sub">
            Detect depeg risk, liquidity strain, and contagion regimes before they become treasury losses.
            Dashboard and API for funds, protocols, and exchanges.
          </p>
          <div className="hero-actions">
            <Link href="/monitor" className="btn-primary">Open Monitor</Link>
            <Link href="/whitepaper" className="btn-secondary">Read Research</Link>
          </div>
        </div>

        {/* Live signal strip */}
        <div className="signal-strip">
          <div className="signal-strip-item">
            <span className="strip-label">USDC</span>
            <span className="strip-regime calm">CALM</span>
          </div>
          <div className="signal-strip-item">
            <span className="strip-label">USDT</span>
            <span className="strip-regime calm">CALM</span>
          </div>
          <div className="signal-strip-item">
            <span className="strip-label">DAI</span>
            <span className="strip-regime elevated">ELEVATED</span>
          </div>
          <div className="signal-strip-item">
            <span className="strip-label">Signal Engine</span>
            <span className="strip-status">
              <span className="pulse-dot"></span>
              ONLINE
            </span>
          </div>
        </div>
      </section>

      {/* Products */}
      <section className="products-section">
        <h2 className="section-title">Products</h2>
        <div className="products-grid">
          <Link href="/monitor" className="product-card">
            <div className="product-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="3" width="20" height="14" rx="2"/>
                <path d="M8 21h8M12 17v4"/>
                <path d="M7 10l3-3 2 2 5-5"/>
              </svg>
            </div>
            <h3>Dsrpt Monitor</h3>
            <p>Live dashboard for stablecoin, liquidity, and contagion risk. Regime detection, confidence scoring, and action recommendations updated every 15 minutes.</p>
            <span className="product-status live">Live</span>
          </Link>

          <div className="product-card">
            <div className="product-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
            </div>
            <h3>Dsrpt Signals API</h3>
            <p>Programmatic access to asset-level risk signals, regime states, and alerts. Built for treasury systems, risk desks, and protocol integrations.</p>
            <span className="product-status coming">Coming Soon</span>
          </div>

          <Link href="/whitepaper" className="product-card">
            <div className="product-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
              </svg>
            </div>
            <h3>Dsrpt Research</h3>
            <p>Event studies, methodology documentation, and postmortems. UST collapse analysis, USDC/SVB shock study, and classifier validation results.</p>
            <span className="product-status live">Available</span>
          </Link>
        </div>
      </section>

      {/* What it detects */}
      <section className="capabilities-section">
        <h2 className="section-title">What the signal engine detects</h2>
        <div className="capabilities-grid">
          <div className="capability">
            <div className="cap-regime reflexive">REFLEXIVE COLLAPSE</div>
            <p>One-way deterioration with no structural floor. Monotonic severity path, volume abandonment. Detected UST 6+ hours before full collapse.</p>
          </div>
          <div className="capability">
            <div className="cap-regime shock">COLLATERAL SHOCK</div>
            <p>Sharp asymmetric spike with fast recovery. High volume, bounded persistence. Characteristic of reserve impairment events like USDC/SVB.</p>
          </div>
          <div className="capability">
            <div className="cap-regime stress">CONTAINED STRESS</div>
            <p>Sustained mild elevation without structural failure. Contagion signal with slow recovery. Typical of events like FRAX March 2023.</p>
          </div>
          <div className="capability">
            <div className="cap-regime dislocation">LIQUIDITY DISLOCATION</div>
            <p>High volume, low price impact. Execution risk elevated but not systemic. Venue-specific fragmentation events.</p>
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="audience-section">
        <h2 className="section-title">Built for</h2>
        <div className="audience-grid">
          <div className="audience-card">
            <h3>Protocol Treasuries</h3>
            <p>Monitor stablecoin reserves in real time. Automated regime alerts trigger rebalancing playbooks before losses materialize.</p>
          </div>
          <div className="audience-card">
            <h3>Trading Desks</h3>
            <p>Programmatic risk signals for position sizing, hedging decisions, and exposure management across stablecoin holdings.</p>
          </div>
          <div className="audience-card">
            <h3>Exchanges</h3>
            <p>Cross-venue spread monitoring, deposit/withdrawal circuit breakers, and collateral haircut automation based on live regime state.</p>
          </div>
          <div className="audience-card">
            <h3>Risk Managers</h3>
            <p>Decision support with explicit action recommendations: monitor, reduce exposure, pause deposits, escalate to manual review.</p>
          </div>
        </div>
      </section>

      {/* On-chain */}
      <section className="onchain-section">
        <h2 className="section-title">On-chain infrastructure</h2>
        <p className="section-sub">6 contracts deployed on Base Mainnet. Signal engine running on Railway. Pricing updates atomic with zero adverse selection gap.</p>
        <div className="contracts-grid">
          <div className="contract-item">
            <span className="contract-name">DsrptHazardEngine</span>
            <span className="contract-desc">Regime-based actuarial pricing</span>
          </div>
          <div className="contract-item">
            <span className="contract-name">OracleAdapter</span>
            <span className="contract-desc">Signal-to-pricing bridge</span>
          </div>
          <div className="contract-item">
            <span className="contract-name">DsrptPolicyManager</span>
            <span className="contract-desc">Policy lifecycle</span>
          </div>
          <div className="contract-item">
            <span className="contract-name">DsrptTreasuryManager</span>
            <span className="contract-desc">Tranche-based capital pools</span>
          </div>
          <div className="contract-item">
            <span className="contract-name">OracleAggregator</span>
            <span className="contract-desc">Multi-source price feeds</span>
          </div>
          <div className="contract-item">
            <span className="contract-name">KeepersAdapter</span>
            <span className="contract-desc">Chainlink Automation</span>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-section">
        <h2>Start monitoring stablecoin risk</h2>
        <p>Open the live dashboard or read the research methodology.</p>
        <div className="hero-actions">
          <Link href="/monitor" className="btn-primary">Open Dsrpt Monitor</Link>
          <Link href="/whitepaper" className="btn-secondary">Research</Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="footer-left">
          <span className="logo-name" style={{ fontSize: 16 }}>DSRPT</span>
          <span className="footer-copy">Crypto stress intelligence. Live on Base.</span>
        </div>
        <div className="footer-links">
          <Link href="/monitor">Monitor</Link>
          <Link href="/whitepaper">Research</Link>
          <Link href="/team">Team</Link>
          <a href="https://basescan.org/address/0x0f43Ca50CFdFb916b2782b9cF878e3F422559524" target="_blank" rel="noopener noreferrer">BaseScan</a>
        </div>
      </footer>
    </main>
  );
}
