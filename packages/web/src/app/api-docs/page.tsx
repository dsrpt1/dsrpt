'use client';

import Link from 'next/link';
import Navigation from '@/components/Navigation';

const endpoints = [
  {
    method: 'GET',
    path: '/api/v1/signals/market',
    title: 'Market Signal',
    description: 'Composite market-wide signal with per-asset breakdown. Returns the highest-severity regime across all tracked assets.',
    auth: 'Free',
    response: `{
  "composite_regime": "ambiguous",
  "composite_regime_id": 0,
  "assets_on_alert": 0,
  "total_assets": 3,
  "updated_at": "2026-03-31T18:00:00Z",
  "assets": [
    {
      "asset": "USDC",
      "updated_at": "2026-03-31T18:00:00Z",
      "price": 0.9998,
      "regime": "ambiguous",
      "regime_id": 0,
      "confidence": 0.28,
      "escalation": 0,
      "premium_multiplier_bps": 10000,
      "peg_dev_bps": 2,
      "max_severity": 0.0009
    }
  ]
}`,
  },
  {
    method: 'GET',
    path: '/api/v1/signals/assets?symbol=USDC',
    title: 'Asset Signal',
    description: 'Detailed signal for a single asset, including partial confidence scores for each regime and 24-hour tick history for sparkline rendering.',
    auth: 'Pro',
    params: [
      { name: 'symbol', type: 'string', required: true, desc: 'Asset symbol (USDC, USDT, DAI)' },
    ],
    response: `{
  "asset": "USDC",
  "updated_at": "2026-03-31T18:00:00Z",
  "price": 0.9998,
  "regime": "ambiguous",
  "regime_id": 0,
  "confidence": 0.28,
  "escalation": 0,
  "peg_dev_bps": 2,
  "max_severity": 0.0009,
  "partial_scores": {
    "reflexive_collapse": 0.473,
    "collateral_shock": 0.378,
    "contained_stress": 0.591,
    "liquidity_dislocation": 0.464
  },
  "recent": [
    { "ts": "2026-03-31T17:45:00Z", "price": 0.9998, "regime": "ambiguous", "confidence": 0.28 },
    { "ts": "2026-03-31T17:30:00Z", "price": 0.9997, "regime": "ambiguous", "confidence": 0.27 }
  ]
}`,
  },
  {
    method: 'GET',
    path: '/api/v1/alerts',
    title: 'Alerts',
    description: 'Recent regime transitions, early warnings, and coldstart events. Filterable by asset and time range.',
    auth: 'Pro',
    params: [
      { name: 'asset', type: 'string', required: false, desc: 'Filter by asset symbol' },
      { name: 'limit', type: 'number', required: false, desc: 'Max results (default 50, max 200)' },
      { name: 'since', type: 'ISO 8601', required: false, desc: 'Only alerts after this timestamp' },
    ],
    response: `{
  "count": 2,
  "alerts": [
    {
      "id": 42,
      "asset": "USDC",
      "ts": "2026-03-15T14:30:00Z",
      "signal_type": "TRANSITION",
      "regime": "collateral_shock",
      "prev_regime": "contained_stress",
      "confidence": 0.82,
      "price": 0.9847,
      "max_severity": 0.0153,
      "rule_fired": "R2b: shape — fast_rise + high_recovery",
      "notes": "Asymmetric spike. Recovery completeness=0.89.",
      "tx_hash": "0xabc123..."
    }
  ]
}`,
  },
  {
    method: 'GET',
    path: '/api/v1/history?symbol=USDC&range=7d',
    title: 'Historical Time Series',
    description: 'Signal tick data for charting and backtesting. Includes price, regime, confidence, and severity at each 15-minute interval. Event markers from alerts overlay.',
    auth: 'Pro',
    params: [
      { name: 'symbol', type: 'string', required: true, desc: 'Asset symbol' },
      { name: 'range', type: 'string', required: false, desc: '1d, 7d, 30d, or 90d (default 7d)' },
    ],
    response: `{
  "asset": "USDC",
  "range": "7d",
  "count": 672,
  "data": [
    {
      "ts": "2026-03-24T18:00:00Z",
      "price": 0.9999,
      "regime": "ambiguous",
      "regime_id": 0,
      "confidence": 0.27,
      "escalation": 0,
      "peg_dev_bps": 1,
      "max_severity": 0.0003
    }
  ],
  "events": [
    {
      "ts": "2026-03-26T09:15:00Z",
      "type": "TRANSITION",
      "regime": "contained_stress",
      "prev_regime": "ambiguous",
      "confidence": 0.71,
      "price": 0.9962
    }
  ]
}`,
  },
];

const regimeReference = [
  { id: 0, name: 'ambiguous', label: 'Ambiguous', desc: 'Insufficient signal. Base pricing.', escalation: 'NORMAL' },
  { id: 1, name: 'contained_stress', label: 'Contained Stress', desc: 'Mild persistent contagion.', escalation: 'ELEVATED' },
  { id: 2, name: 'liquidity_dislocation', label: 'Liquidity Dislocation', desc: 'Execution risk, not systemic.', escalation: 'ELEVATED' },
  { id: 3, name: 'collateral_shock', label: 'Collateral Shock', desc: 'Sharp reserve impairment.', escalation: 'ESCALATING' },
  { id: 4, name: 'reflexive_collapse', label: 'Reflexive Collapse', desc: 'Terminal spiral. Issuance halted.', escalation: 'CRITICAL' },
];

export default function ApiDocsPage() {
  return (
    <main className="landing-page">
      <header className="top-bar">
        <div className="logo-section">
          <div className="logo-mark">
            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M16 2L4 8v16l12 6 12-6V8L16 2z" stroke="url(#lg3)" strokeWidth="2" fill="none"/>
              <circle cx="16" cy="16" r="4" fill="url(#lg3)"/>
              <defs><linearGradient id="lg3" x1="0" y1="0" x2="32" y2="32"><stop stopColor="#00d4ff"/><stop offset="1" stopColor="#a855f7"/></linearGradient></defs>
            </svg>
          </div>
          <div className="logo-text"><span className="logo-name">DSRPT</span></div>
        </div>
        <Navigation />
        <a href="#request-access" className="btn-primary" style={{ padding: '8px 20px', fontSize: 13 }}>Request API Key</a>
      </header>

      <section className="products-section" style={{ maxWidth: 900 }}>
        <h1 className="section-title" style={{ fontSize: 36 }}>Signals API</h1>
        <p className="section-sub">Machine-readable stablecoin stress signals for treasury systems, risk desks, and protocol integrations.</p>

        <div className="api-info-bar">
          <div className="api-info-item">
            <span className="api-info-label">Base URL</span>
            <code>https://dsrpt.finance/api/v1</code>
          </div>
          <div className="api-info-item">
            <span className="api-info-label">Format</span>
            <code>JSON</code>
          </div>
          <div className="api-info-item">
            <span className="api-info-label">Update Frequency</span>
            <code>15 min</code>
          </div>
          <div className="api-info-item">
            <span className="api-info-label">Auth</span>
            <code>API Key (header)</code>
          </div>
        </div>

        {/* Endpoints */}
        {endpoints.map((ep) => (
          <div key={ep.path} className="api-doc-block" id={ep.title.toLowerCase().replace(/ /g, '-')}>
            <div className="api-doc-header">
              <div className="api-endpoint">
                <code className="api-method">{ep.method}</code>
                <code className="api-path">{ep.path}</code>
              </div>
              <span className={`api-auth-badge ${ep.auth === 'Free' ? 'free' : 'pro'}`}>{ep.auth}</span>
            </div>
            <p className="api-doc-desc">{ep.description}</p>

            {ep.params && (
              <div className="api-params">
                <h4>Parameters</h4>
                <table className="params-table">
                  <thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
                  <tbody>
                    {ep.params.map(p => (
                      <tr key={p.name}>
                        <td><code>{p.name}</code></td>
                        <td>{p.type}</td>
                        <td>{p.required ? 'Yes' : 'No'}</td>
                        <td>{p.desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="api-params">
              <h4>Response</h4>
              <pre className="api-response">{ep.response}</pre>
            </div>
          </div>
        ))}

        {/* Regime Reference */}
        <div className="api-doc-block">
          <h3 style={{ color: 'var(--text-primary)', marginBottom: 16, fontSize: 18 }}>Regime Reference</h3>
          <table className="params-table">
            <thead><tr><th>ID</th><th>Name</th><th>Label</th><th>Description</th><th>Escalation</th></tr></thead>
            <tbody>
              {regimeReference.map(r => (
                <tr key={r.id}>
                  <td><code>{r.id}</code></td>
                  <td><code>{r.name}</code></td>
                  <td>{r.label}</td>
                  <td>{r.desc}</td>
                  <td><span className={`strip-regime ${r.id === 0 ? 'calm' : r.id <= 2 ? 'elevated' : 'critical'}`}>{r.escalation}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Rate Limits */}
        <div className="api-doc-block">
          <h3 style={{ color: 'var(--text-primary)', marginBottom: 16, fontSize: 18 }}>Rate Limits</h3>
          <table className="params-table">
            <thead><tr><th>Tier</th><th>Rate Limit</th><th>History</th><th>Assets</th></tr></thead>
            <tbody>
              <tr><td>Free</td><td>10 req/min</td><td>7 days</td><td>USDC only</td></tr>
              <tr><td>Pro</td><td>60 req/min</td><td>90 days</td><td>All tracked</td></tr>
              <tr><td>Enterprise</td><td>300 req/min</td><td>Full backtest</td><td>All + custom</td></tr>
            </tbody>
          </table>
        </div>

        <div style={{ textAlign: 'center', marginTop: 40 }} id="request-access">
          <h3 style={{ color: 'var(--text-primary)', marginBottom: 8 }}>Get API Access</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 20, fontSize: 14 }}>Contact us for API keys and integration support.</p>
          <a href="mailto:daniel@cooktradingcorp.com?subject=Dsrpt API Access Request" className="btn-primary">Request API Key</a>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="footer-left">
          <span className="logo-name" style={{ fontSize: 16 }}>DSRPT</span>
          <span className="footer-copy">Real-time crypto stress intelligence.</span>
        </div>
        <div className="footer-links">
          <Link href="/monitor">Monitor</Link>
          <Link href="/whitepaper">Research</Link>
          <Link href="/pricing">Pricing</Link>
        </div>
      </footer>

      <style jsx>{`
        .api-info-bar {
          display: flex;
          gap: 24px;
          flex-wrap: wrap;
          padding: 20px 24px;
          background: var(--bg-panel);
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          margin-bottom: 32px;
        }
        .api-info-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .api-info-label {
          font-size: 10px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .api-info-item code {
          font-size: 13px;
          color: var(--accent-cyan);
          font-family: 'SF Mono', 'Fira Code', monospace;
        }
        .api-doc-block {
          background: var(--bg-panel);
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          padding: 24px;
          margin-bottom: 20px;
        }
        .api-doc-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .api-auth-badge {
          font-size: 11px;
          font-weight: 700;
          padding: 3px 10px;
          border-radius: 4px;
          text-transform: uppercase;
        }
        .api-auth-badge.free {
          color: #22c55e;
          background: rgba(34, 197, 94, 0.1);
          border: 1px solid rgba(34, 197, 94, 0.2);
        }
        .api-auth-badge.pro {
          color: #a855f7;
          background: rgba(168, 85, 247, 0.1);
          border: 1px solid rgba(168, 85, 247, 0.2);
        }
        .api-doc-desc {
          font-size: 14px;
          color: var(--text-secondary);
          line-height: 1.6;
          margin-bottom: 16px;
        }
        .api-params {
          margin-top: 16px;
        }
        .api-params h4 {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 8px;
        }
        .params-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .params-table th {
          padding: 8px 12px;
          text-align: left;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 1px solid var(--border-subtle);
        }
        .params-table td {
          padding: 8px 12px;
          color: var(--text-secondary);
          border-bottom: 1px solid var(--border-subtle);
        }
        .params-table tr:last-child td {
          border-bottom: none;
        }
        .params-table code {
          color: var(--accent-cyan);
          font-family: 'SF Mono', 'Fira Code', monospace;
          font-size: 12px;
        }
      `}</style>
    </main>
  );
}
