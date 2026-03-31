'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Navigation from '@/components/Navigation';
import SignalChart from '@/components/SignalChart';

type AssetSignal = {
  asset: string;
  price: string;
  regime: string;
  regimeClass: string;
  confidence: string;
  action: string;
};

// Consistent regime display names — maps signal engine output to user-facing labels.
// Signal engine uses: ambiguous, contained_stress, liquidity_dislocation, collateral_shock, reflexive_collapse
// Display uses the same names, formatted. No separate "CALM/ELEVATED" layer to avoid confusion.
function formatRegime(regime: string): string {
  return regime.replace(/_/g, ' ').toUpperCase();
}

function regimeClass(regimeId: number): string {
  if (regimeId === 0) return 'calm';
  if (regimeId <= 2) return 'elevated';
  return 'critical';
}

function actionForEscalation(escalation: number): string {
  if (escalation >= 3) return 'Reduce Exposure';
  if (escalation >= 2) return 'Pause Deposits';
  if (escalation >= 1) return 'Monitor Closely';
  return 'Normal Operations';
}

const STATIC_SIGNALS: AssetSignal[] = [
  { asset: 'USDC', price: '$1.0000', regime: 'AMBIGUOUS', regimeClass: 'calm', confidence: '28%', action: 'Normal Operations' },
  { asset: 'USDT', price: '$0.9991', regime: 'AMBIGUOUS', regimeClass: 'calm', confidence: '31%', action: 'Normal Operations' },
  { asset: 'DAI',  price: '$0.9999', regime: 'LIQUIDITY DISLOCATION', regimeClass: 'elevated', confidence: '80%', action: 'Monitor Closely' },
];

export default function HomePage() {
  const [signals, setSignals] = useState<AssetSignal[]>(STATIC_SIGNALS);
  const [lastUpdate, setLastUpdate] = useState('');
  const [formSubmitted, setFormSubmitted] = useState(false);

  useEffect(() => {
    fetch('/api/v1/signals/market')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.assets?.length > 0) {
          setSignals(data.assets.map((a: Record<string, unknown>) => ({
            asset: a.asset as string,
            price: `$${(a.price as number).toFixed(4)}`,
            regime: formatRegime(a.regime as string),
            regimeClass: regimeClass(a.regime_id as number),
            confidence: `${((a.confidence as number) * 100).toFixed(0)}%`,
            action: actionForEscalation(a.escalation as number),
          })));
          setLastUpdate(new Date(data.updated_at as string).toLocaleTimeString('en-US', { hour12: false }));
        }
      })
      .catch(() => {});
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
          <div className="logo-text"><span className="logo-name">DSRPT</span></div>
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
            <a href="#request-access" className="btn-secondary">Request API Access</a>
          </div>
        </div>
      </section>

      {/* Section 2: Live Signal Table */}
      <section className="products-section">
        <h2 className="section-title">Live Signal</h2>
        <p className="section-sub">
          Updated every 15 minutes. Classification powered by trajectory-shaped features across a 48-hour sliding window.
          {lastUpdate && <span style={{ color: 'var(--accent-cyan)', marginLeft: 8 }}>Last update: {lastUpdate} UTC</span>}
        </p>

        <div className="watchlist-table-wrap">
          <table className="watchlist-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Price</th>
                <th>Signal Regime</th>
                <th>Confidence <span className="th-hint" title="Classification certainty based on how closely current trajectory features match the regime's rule thresholds. Higher = stronger match.">(?)</span></th>
                <th>Recommended Action</th>
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

        <div className="confidence-note">
          Confidence = classification certainty. Measures how closely current trajectory features (monotonicity, recovery completeness, severity persistence) match the active regime's rule thresholds. 80%+ = high conviction.
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

      {/* Section 3: Live Chart */}
      <section className="products-section" style={{ paddingTop: 0 }}>
        <SignalChart symbol="USDC" />
      </section>

      {/* Section 4: What it detects */}
      <section className="capabilities-section">
        <h2 className="section-title">Signal Regimes</h2>
        <p className="section-sub">Five regimes derived from trajectory geometry — slope, persistence, rebound quality, and cross-venue divergence. Not endpoint rules.</p>
        <div className="capabilities-grid">
          <div className="capability">
            <div className="cap-regime reflexive">REFLEXIVE COLLAPSE</div>
            <p>Monotonic severity path with no recovery signal. Triggers: monotonicity score &gt; 0.55, deterioration run &gt; 25% of window, recovery completeness &lt; 50%. Detected UST 141h before trough.</p>
          </div>
          <div className="capability">
            <div className="cap-regime shock">COLLATERAL SHOCK</div>
            <p>Fast spike, fast recovery, bounded persistence. Triggers: recovery completeness &gt; 70%, early/late severity ratio &gt; 2x, persistence &lt; 35%. Detected USDC/SVB 9h before $0.919 trough.</p>
          </div>
          <div className="capability">
            <div className="cap-regime stress">CONTAINED STRESS</div>
            <p>Sustained mild elevation, contagion without structural failure. Triggers: max severity 1-12%, persistence &gt; 20%, recovery half-life &gt; 12h. Characteristic of FRAX March 2023.</p>
          </div>
          <div className="capability">
            <div className="cap-regime dislocation">LIQUIDITY DISLOCATION</div>
            <p>High volume, low price impact. Execution risk elevated but not systemic. Triggers: max severity &lt; 3%, persistence &lt; 15%, volume spike ratio &gt; 4x. Venue-specific fragmentation.</p>
          </div>
        </div>
      </section>

      {/* Section 5: Use cases */}
      <section className="audience-section">
        <h2 className="section-title">Built for</h2>
        <div className="audience-grid">
          <div className="audience-card">
            <h3>Protocol Treasuries</h3>
            <p>Monitor stablecoin reserves. Regime alerts trigger rebalancing playbooks before losses materialize.</p>
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

      {/* Section 6: API */}
      <section className="products-section">
        <h2 className="section-title">Signals API</h2>
        <p className="section-sub">Machine-readable risk signals. Same data as the dashboard, structured for integration.</p>

        <div className="api-demo">
          <div className="api-endpoint">
            <code className="api-method">GET</code>
            <code className="api-path">/api/v1/signals/assets?symbol=USDC</code>
          </div>
          <pre className="api-response">{`{
  "asset": "USDC",
  "price": 0.9998,
  "regime": "ambiguous",
  "regime_id": 0,
  "confidence": 0.28,
  "escalation": 0,
  "peg_dev_bps": 2,
  "max_severity": 0.0009,
  "partial_scores": {
    "reflexive_collapse": 0.47,
    "collateral_shock": 0.38,
    "contained_stress": 0.58,
    "liquidity_dislocation": 0.46
  },
  "recent": [ ... ]
}`}</pre>
          <div className="api-endpoints-list">
            <div className="api-ep"><code>GET /api/v1/signals/market</code><span>Composite market signal + all assets</span></div>
            <div className="api-ep"><code>GET /api/v1/signals/assets?symbol=USDC</code><span>Single asset with partial scores + 24h history</span></div>
            <div className="api-ep"><code>GET /api/v1/alerts</code><span>Regime transitions, warnings, confidence shifts</span></div>
            <div className="api-ep"><code>GET /api/v1/history?symbol=USDC&range=30d</code><span>Time series with event markers for charting</span></div>
          </div>
        </div>
      </section>

      {/* Section 7: Methodology */}
      <section className="capabilities-section">
        <h2 className="section-title">Methodology</h2>
        <p className="section-sub">Validated against real depeg events. The classifier uses trajectory features — not where the price ended, but how it got there.</p>
        <div className="capabilities-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <div className="capability">
            <h4 style={{ color: 'var(--text-primary)', marginBottom: 8 }}>UST / May 2022</h4>
            <p>Reflexive collapse. First alert at $0.984, 141h before terminal trough at $0.018. Key features: monotonicity score 0.72, deterioration run 84h (60% of window), early/late ratio 0.21, recovery completeness 0.03. No false recovery signal.</p>
          </div>
          <div className="capability">
            <h4 style={{ color: 'var(--text-primary)', marginBottom: 8 }}>USDC / March 2023</h4>
            <p>Collateral shock. First alert at $0.985, 9h before trough at $0.919. Key features: recovery completeness 0.89, early/late ratio 3.2, peak recovery asymmetry 0.4, persistence 0.28. Correctly classified as bounded, not structural.</p>
          </div>
        </div>
        <div className="methodology-detail">
          <h4>Trajectory Features (v2 classifier)</h4>
          <ul>
            <li><strong>Monotonicity score</strong> — fraction of timesteps where severity is non-decreasing. High = one-way deterioration.</li>
            <li><strong>Recovery completeness</strong> — how much of peak severity has resolved. Low + high monotonicity = collapse.</li>
            <li><strong>Early/late ratio</strong> — mean severity in first 25% vs last 25% of window. Below 0.40 = worsening conditions.</li>
            <li><strong>Deterioration run</strong> — longest consecutive increasing-severity window in hours. Long runs = structural failure.</li>
            <li><strong>Abandonment signal</strong> — gap between raw and adjusted recovery. Detects volume collapse masking terminal severity.</li>
          </ul>
        </div>
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <Link href="/whitepaper" className="btn-secondary">Full Research Paper</Link>
        </div>
      </section>

      {/* Section 8: Risk products */}
      <section className="products-section" style={{ paddingBottom: 32 }}>
        <h2 className="section-title">On-chain Risk Products</h2>
        <p className="section-sub">
          Parametric depeg protection powered by the signal engine. 6 contracts deployed on Base Mainnet.
          <br/><span style={{ color: 'var(--accent-amber)' }}>Pilot access only — contact for details.</span>
        </p>
      </section>

      {/* Section 9: Request Access */}
      <section className="products-section" id="request-access">
        <h2 className="section-title">Request Access</h2>
        <p className="section-sub">Get API keys, dashboard access, or schedule a demo.</p>

        {formSubmitted ? (
          <div className="access-form-success">
            Received. We will be in touch within 24 hours.
          </div>
        ) : (
          <form
            className="access-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.target as HTMLFormElement;
              const data = new FormData(form);
              // Send to email via formspree or similar — for now just mailto fallback
              const body = `Name: ${data.get('name')}\nEmail: ${data.get('email')}\nOrg: ${data.get('org')}\nUse case: ${data.get('usecase')}`;
              window.location.href = `mailto:daniel@cooktradingcorp.com?subject=Dsrpt API Access Request&body=${encodeURIComponent(body)}`;
              setFormSubmitted(true);
            }}
          >
            <div className="form-row">
              <input name="name" type="text" placeholder="Name" required className="form-input" />
              <input name="email" type="email" placeholder="Email" required className="form-input" />
            </div>
            <div className="form-row">
              <input name="org" type="text" placeholder="Organization" className="form-input" />
              <select name="usecase" className="form-input" defaultValue="">
                <option value="" disabled>Use case</option>
                <option value="treasury">Protocol Treasury</option>
                <option value="desk">Trading Desk</option>
                <option value="exchange">Exchange</option>
                <option value="risk">Risk Management</option>
                <option value="integration">API Integration</option>
                <option value="other">Other</option>
              </select>
            </div>
            <button type="submit" className="btn-primary" style={{ marginTop: 16 }}>Submit Request</button>
          </form>
        )}
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
          <a href="#request-access">Contact</a>
        </div>
      </footer>
    </main>
  );
}
