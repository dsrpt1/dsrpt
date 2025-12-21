'use client';

import Link from 'next/link';

const steps = [
  {
    number: '01',
    title: 'Connect Your Wallet',
    description: 'Connect any Web3 wallet to access DSRPT on Base. The protocol runs entirely on-chain with no intermediaries.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <path d="M22 10H2M6 14h.01M10 14h.01" />
      </svg>
    ),
  },
  {
    number: '02',
    title: 'Choose Coverage Amount',
    description: 'Select how much USDC exposure you want to protect. Coverage represents the notional value at risk.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
      </svg>
    ),
  },
  {
    number: '03',
    title: 'Select Duration',
    description: 'Pick your protection period: 7, 30, or 90 days. The HazardEngine calculates risk-adjusted premiums using actuarial hazard curves.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
  },
  {
    number: '04',
    title: 'Pay Premium',
    description: 'Pay in USDC. Premium = coverage × hazard rate × duration. A minimum floor (0.25%) ensures treasury sustainability even in calm markets.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 14l6-6M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <circle cx="9" cy="9" r="2" />
        <circle cx="15" cy="15" r="2" />
      </svg>
    ),
  },
  {
    number: '05',
    title: 'Continuous Oracle Updates',
    description: 'The OracleAggregator pulls real-time USDC/USD prices from Chainlink. A keeper daemon updates on-chain state every 5 minutes.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },
  {
    number: '06',
    title: 'Parametric Payout',
    description: 'If USDC drops below the $0.98 strike price, the PolicyManager calculates and executes payouts automatically. No claims, no delays.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
];

const features = [
  {
    title: 'Chainlink Oracle Integration',
    description: 'OracleAggregator pulls from Chainlink USDC/USD price feeds with configurable staleness thresholds for reliable, manipulation-resistant data.',
    icon: '🔗',
  },
  {
    title: 'Hazard Curve Pricing',
    description: 'HazardEngine uses actuarial hazard curves that scale premiums based on current price deviation from peg. Higher risk = higher premium.',
    icon: '📈',
  },
  {
    title: 'Fully Collateralized Treasury',
    description: 'TreasuryManager holds USDC reserves to back all active policies. Protocol solvency is verifiable on-chain at any time.',
    icon: '🏦',
  },
  {
    title: 'Keeper Automation',
    description: 'KeepersAdapter enables automated oracle updates and policy settlements. The Risk Engine daemon runs 24/7 on distributed infrastructure.',
    icon: '⚙️',
  },
];

export default function HowItWorksPage() {
  return (
    <main className="page-container how-it-works-page">
      {/* Header */}
      <header className="page-header">
        <Link href="/" className="back-link">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </Link>
        <div className="page-title-section">
          <h1>How It Works</h1>
          <p>Parametric protection powered by Chainlink oracles and actuarial risk models</p>
        </div>
      </header>

      {/* Process Steps */}
      <section className="steps-section">
        <h2>The Process</h2>
        <div className="steps-grid">
          {steps.map((step, index) => (
            <div key={index} className="step-card">
              <div className="step-number">{step.number}</div>
              <div className="step-icon">{step.icon}</div>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="features-section">
        <h2>Key Features</h2>
        <div className="features-grid">
          {features.map((feature, index) => (
            <div key={index} className="feature-card">
              <span className="feature-icon">{feature.icon}</span>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Payout Example */}
      <section className="payout-section">
        <h2>Payout Example</h2>
        <div className="payout-example">
          <div className="example-scenario">
            <h3>Scenario</h3>
            <ul>
              <li><span>Coverage:</span> $10,000 USDC</li>
              <li><span>Duration:</span> 30 days</li>
              <li><span>Strike Price:</span> $0.98</li>
              <li><span>Premium:</span> $25 (0.25% floor)</li>
              <li><span>USDC Drops to:</span> $0.95</li>
            </ul>
          </div>
          <div className="example-arrow">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </div>
          <div className="example-result">
            <h3>Your Payout</h3>
            <div className="payout-amount">$300</div>
            <p>($0.98 - $0.95) × $10,000</p>
            <span className="payout-note">Payout = (strike - spot) × coverage</span>
          </div>
        </div>
      </section>

      {/* Architecture */}
      <section className="architecture-section">
        <h2>Protocol Architecture</h2>
        <div className="architecture-grid">
          <div className="arch-card">
            <h3>OracleAggregator</h3>
            <p>Aggregates Chainlink price feeds with configurable staleness thresholds. Stores snapshots for policy settlement.</p>
          </div>
          <div className="arch-card">
            <h3>HazardEngine</h3>
            <p>Computes risk using hazard curves calibrated to historical depeg events. Outputs premium rates and trigger conditions.</p>
          </div>
          <div className="arch-card">
            <h3>PolicyManager</h3>
            <p>Manages policy lifecycle: creation, premium collection, settlement, and payout distribution.</p>
          </div>
          <div className="arch-card">
            <h3>TreasuryManager</h3>
            <p>Holds protocol reserves. Ensures full collateralization of active policies and processes payouts.</p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-section">
        <h2>Ready to Get Protected?</h2>
        <p>Start protecting your USDC holdings in less than 2 minutes.</p>
        <Link href="/" className="cta-button">
          Go to Dashboard
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </Link>
      </section>
    </main>
  );
}
