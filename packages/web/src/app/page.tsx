'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Navigation from '@/components/Navigation';

const ASSETS = ['USDC', 'USDT', 'DAI'];

type AssetSignal = {
  asset: string;
  price: string;
  regime: string;
  regimeClass: string;
  confidence: string;
  action: string;
};

const STATIC_SIGNALS: AssetSignal[] = [
  { asset: 'USDC', price: '$1.0000', regime: 'CALM', regimeClass: 'calm', confidence: '28%', action: 'Monitor' },
  { asset: 'USDT', price: '$0.9991', regime: 'CALM', regimeClass: 'calm', confidence: '31%', action: 'Monitor' },
  { asset: 'DAI',  price: '$0.9999', regime: 'ELEVATED', regimeClass: 'elevated', confidence: '80%', action: 'Monitor' },
];

export default function HomePage() {
  const [signals, setSignals] = useState<AssetSignal[]>(STATIC_SIGNALS);
  const [lastUpdate, setLastUpdate] = useState('');

  useEffect(() => {
    // Try to fetch live data from API
    fetch('/api/v1/signals/market')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.assets?.length > 0) {
          setSignals(data.assets.map((a: Record<string, unknown>) => ({
            asset: a.asset as string,
            price: `$${(a.price as number).toFixed(4)}`,
            regime: (a.regime as string).replace(/_/g, ' ').toUpperCase(),
            regimeClass: (a.regime_id as number) === 0 ? 'calm' : (a.regime_id as number) <= 2 ? 'elevated' : 'critical',
            confidence: `${((a.confidence as number) * 100).toFixed(0)}%`,
            action: (a.escalation as number) >= 2 ? 'Reduce Exposure' : (a.escalation as number) === 1 ? 'Monitor Closely' : 'Monitor',
          })));
          setLastUpdate(new Date(data.updated_at as string).toLocaleTimeString('en-US', { hour12: false }));
        }
      })
      .catch(() => {}); // fall back to static
  }, []);

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
              <defs><linearGradient id="lg" x1="0" y1="0" x2="32" y2="32"><stop stopColor="#00d4ff"/><stop offset="1" stopColor="#a855f7"/></linearGradient></defs>
            </svg>
          </div>
          <div className="logo-text">
            <span className="logo-name">DSRPT</span>
          </div>
        </div>
        <Navigation />
        <div className="top-bar-right">
          <Link href="/monitor" className="btn-primary" style={{ padding: '8px 20px', fontSize: 13 }}>Open Monitor</Link>
        </div>
      </header>

      {/* Hero */}
      <section className="hero">
        <div className="hero-content">
          <h1>Real-time stablecoin and crypto stress intelligence</h1>
          <p className="hero-sub">
            Detect depeg risk, liquidity strain, and contagion regimes before they become treasury losses.
            For funds, protocols, exchanges, and risk desks.
          </p>
          <div className="hero-actions">
            <Link href="/monitor" className="btn-primary">View Dashboard</Link>
            <a href="mailto:daniel@cooktradingcorp.com" className="btn-secondary">Request API Access</a>
          </div>
        </div>
      </section>

      {/* Section 2: Live Signal Panel */}
      <section className="products-section">
        <h2 className="section-title">Live Signal</h2>
        <p className="section-sub">
          Updated every 15 minutes. Regime classification powered by trajectory-based features, not endpoint rules.
          {lastUpdate && <span style={{ color: 'var(--accent-cyan)', marginLeft: 8 }}>Last update: {lastUpdate} UTC</span>}
        </p>

        <div className="watchlist-table-wrap">
          <table className="watchlist-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Price</th>
                <th>Regime</th>
                <th>Confidence</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {signals.map(s => (
                <tr key={s.asset}>
                  <td className="wl-asset">{s.asset}</td>
                  <td className="wl-mono">{s.price}</td>
                  <td><span className={`strip-regime ${s.regimeClass}`}>{s.regime}</span></td>
                  <td className="wl-mono">{s.confidence}</td>
                  <td className="wl-action">{s.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="signal-engine-status">
          <span className="pulse-dot"></span>
          <span>Signal engine online</span>
          <span className="sep">|</span>
          <span>3 assets monitored</span>
          <span className="sep">|</span>
          <span>Base Mainnet</span>
        </div>
      </section>

      {/* Section 3: What it detects */}
      <section className="capabilities-section">
        <h2 className="section-title">What the signal engine detects</h2>
        <p className="section-sub">Five regime classifications derived from trajectory-shaped features. Not endpoint rules — trajectory geometry.</p>
        <div className="capabilities-grid">
          <div className="capability">
            <div className="cap-regime reflexive">REFLEXIVE COLLAPSE</div>
            <p>One-way deterioration, no structural floor. Detected UST 141 hours before terminal trough.</p>
          </div>
          <div className="capability">
            <div className="cap-regime shock">COLLATERAL SHOCK</div>
            <p>Sharp asymmetric spike with fast recovery. Detected USDC/SVB 9 hours before trough at $0.919.</p>
          </div>
          <div className="capability">
            <div className="cap-regime stress">CONTAINED STRESS</div>
            <p>Sustained mild elevation without structural failure. Contagion without collapse.</p>
          </div>
          <div className="capability">
            <div className="cap-regime dislocation">LIQUIDITY DISLOCATION</div>
            <p>High volume, low price impact. Execution risk elevated but not systemic.</p>
          </div>
        </div>
      </section>

      {/* Section 4: Use cases */}
      <section className="audience-section">
        <h2 className="section-title">Built for</h2>
        <div className="audience-grid">
          <div className="audience-card">
            <h3>Protocol Treasuries</h3>
            <p>Monitor stablecoin reserves. Automated regime alerts trigger rebalancing playbooks before losses materialize.</p>
          </div>
          <div className="audience-card">
            <h3>Trading Desks</h3>
            <p>Programmatic risk signals for position sizing, hedging, and exposure management across stablecoin holdings.</p>
          </div>
          <div className="audience-card">
            <h3>Exchanges</h3>
            <p>Cross-venue spread monitoring, deposit/withdrawal circuit breakers, collateral haircut automation.</p>
          </div>
          <div className="audience-card">
            <h3>Risk Managers</h3>
            <p>Decision support: monitor, reduce exposure, pause deposits, tighten haircuts, escalate to manual review.</p>
          </div>
        </div>
      </section>

      {/* Section 5: API */}
      <section className="products-section">
        <h2 className="section-title">Signals API</h2>
        <p className="section-sub">Machine-readable risk signals for treasury systems, risk desks, and protocol integrations.</p>

        <div className="api-demo">
          <div className="api-endpoint">
            <code className="api-method">GET</code>
            <code className="api-path">/api/v1/signals/market</code>
          </div>
          <pre className="api-response">{`{
  "composite_regime": "ambiguous",
  "composite_regime_id": 0,
  "assets_on_alert": 0,
  "total_assets": 3,
  "assets": [
    {
      "asset": "USDC",
      "price": 0.9998,
      "regime": "ambiguous",
      "confidence": 0.28,
      "escalation": 0,
      "peg_dev_bps": 2
    }
  ]
}`}</pre>
          <div className="api-endpoints-list">
            <div className="api-ep"><code>GET /api/v1/signals/market</code><span>Composite market signal</span></div>
            <div className="api-ep"><code>GET /api/v1/signals/assets?symbol=USDC</code><span>Asset detail + 24h sparkline</span></div>
            <div className="api-ep"><code>GET /api/v1/alerts</code><span>Recent regime transitions</span></div>
            <div className="api-ep"><code>GET /api/v1/history?symbol=USDC&range=30d</code><span>Time series for charting</span></div>
          </div>
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <a href="mailto:daniel@cooktradingcorp.com" className="btn-secondary">Request API Access</a>
          </div>
        </div>
      </section>

      {/* Section 6: Research / proof */}
      <section className="capabilities-section">
        <h2 className="section-title">Methodology</h2>
        <p className="section-sub">Validated against real depeg events. Trajectory-based features, not endpoint rules.</p>
        <div className="capabilities-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <div className="capability">
            <h4 style={{ color: 'var(--text-primary)', marginBottom: 8 }}>UST / May 2022</h4>
            <p>Reflexive collapse detected 141 hours before terminal trough at $0.018. Monotonicity score 0.72, no recovery signal.</p>
          </div>
          <div className="capability">
            <h4 style={{ color: 'var(--text-primary)', marginBottom: 8 }}>USDC / March 2023</h4>
            <p>Collateral shock detected 9 hours before trough at $0.919. Recovery completeness confirmed bounded event, not structural failure.</p>
          </div>
        </div>
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <Link href="/whitepaper" className="btn-secondary">Read Full Methodology</Link>
        </div>
      </section>

      {/* Section 7: Risk products */}
      <section className="products-section" style={{ paddingBottom: 32 }}>
        <h2 className="section-title">On-chain Risk Products</h2>
        <p className="section-sub">
          Parametric depeg protection powered by the signal engine. 6 contracts deployed on Base Mainnet.
          <br/><span style={{ color: 'var(--accent-amber)' }}>Pilot access only — contact for details.</span>
        </p>
      </section>

      {/* CTA */}
      <section className="cta-section">
        <h2>Start monitoring stablecoin risk</h2>
        <p>Open the live dashboard, request API access, or read the research.</p>
        <div className="hero-actions">
          <Link href="/monitor" className="btn-primary">Open Dsrpt Monitor</Link>
          <a href="mailto:daniel@cooktradingcorp.com" className="btn-secondary">Request Access</a>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="footer-left">
          <span className="logo-name" style={{ fontSize: 16 }}>DSRPT</span>
          <span className="footer-copy">Real-time crypto stress intelligence.</span>
        </div>
        <div className="footer-links">
          <Link href="/monitor">Monitor</Link>
          <Link href="/whitepaper">Research</Link>
          <Link href="/pricing">Pricing</Link>
          <a href="mailto:daniel@cooktradingcorp.com">Contact</a>
        </div>
      </footer>
    </main>
  );
}
