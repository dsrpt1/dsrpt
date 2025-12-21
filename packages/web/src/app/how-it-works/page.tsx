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
          <p className="mission-statement">Decentralized parametric risk markets for financial primitives on Base</p>
        </div>
      </header>

      {/* Hero Definition */}
      <section className="hero-definition">
        <div className="definition-card">
          <h2>What is Parametric Protection?</h2>
          <p>
            Unlike traditional insurance that requires claims and adjusters, <strong>parametric contracts pay out automatically</strong> when
            predefined conditions are met. If USDC drops below $0.98, you get paid. No paperwork. No disputes. Just math.
          </p>
        </div>
      </section>

      {/* Why It Matters */}
      <section className="why-section">
        <h2>Why It Matters</h2>
        <p className="why-intro">
          Stablecoins are the backbone of DeFi, but they carry hidden risks. When USDC depegged in March 2023,
          billions in value evaporated overnight. DSRPT gives you a way to hedge that tail risk.
        </p>
        <div className="benefits-grid">
          <div className="benefit-card">
            <div className="benefit-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <h3>Instant Payouts</h3>
            <p>No waiting for claims approval. Oracle confirms the depeg, smart contract executes the payout. Done.</p>
          </div>
          <div className="benefit-card">
            <div className="benefit-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <h3>Tail Risk Hedge</h3>
            <p>Protect large USDC positions against black swan events. Sleep well knowing your downside is covered.</p>
          </div>
          <div className="benefit-card">
            <div className="benefit-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h3>Fully On-Chain</h3>
            <p>No counterparty risk. No centralized intermediaries. Verify everything on Base.</p>
          </div>
          <div className="benefit-card">
            <div className="benefit-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </div>
            <h3>Capital Efficient</h3>
            <p>Pay a small premium, get significant coverage. Typical cost: 0.25% for 30 days of protection.</p>
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="usecases-section">
        <h2>Who Is This For?</h2>
        <div className="usecases-grid">
          <div className="usecase-card">
            <div className="usecase-header">
              <span className="usecase-icon">🏦</span>
              <h3>DeFi Treasuries</h3>
            </div>
            <p className="usecase-scenario">
              &ldquo;Our DAO holds $2M in USDC for operations. A depeg would be catastrophic.&rdquo;
            </p>
            <p className="usecase-solution">
              Protect your treasury reserves against stablecoin failure. Cover operational funds so a depeg doesn&apos;t halt your project.
            </p>
          </div>
          <div className="usecase-card">
            <div className="usecase-header">
              <span className="usecase-icon">🐋</span>
              <h3>Large Holders</h3>
            </div>
            <p className="usecase-scenario">
              &ldquo;I&apos;ve got $500K sitting in USDC earning yield. What if Circle has issues?&rdquo;
            </p>
            <p className="usecase-solution">
              Hedge your stablecoin exposure while maintaining liquidity. Keep earning yield, sleep better at night.
            </p>
          </div>
          <div className="usecase-card">
            <div className="usecase-header">
              <span className="usecase-icon">🔄</span>
              <h3>Liquidity Providers</h3>
            </div>
            <p className="usecase-scenario">
              &ldquo;I provide liquidity to USDC pools. A depeg means impermanent loss on steroids.&rdquo;
            </p>
            <p className="usecase-solution">
              Offset potential LP losses during depeg events. The payout helps compensate for impermanent loss.
            </p>
          </div>
          <div className="usecase-card">
            <div className="usecase-header">
              <span className="usecase-icon">📊</span>
              <h3>Trading Desks</h3>
            </div>
            <p className="usecase-scenario">
              &ldquo;We hold USDC as collateral for leveraged positions. A depeg could liquidate us.&rdquo;
            </p>
            <p className="usecase-solution">
              Protect collateral value during market stress. Avoid cascading liquidations from stablecoin instability.
            </p>
          </div>
        </div>
      </section>

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

      {/* FAQ */}
      <section className="faq-section">
        <h2>Frequently Asked Questions</h2>
        <div className="faq-grid">
          <div className="faq-item">
            <h3>What triggers a payout?</h3>
            <p>
              When the Chainlink USDC/USD oracle reports a price below the strike price ($0.98), your policy is eligible for payout.
              The payout is calculated as: (strike price - current price) × coverage amount.
            </p>
          </div>
          <div className="faq-item">
            <h3>How quickly do payouts happen?</h3>
            <p>
              Payouts are triggered automatically by the keeper network within minutes of a depeg event being confirmed on-chain.
              No claim forms, no waiting period, no human approval needed.
            </p>
          </div>
          <div className="faq-item">
            <h3>What if USDC re-pegs quickly?</h3>
            <p>
              Payouts are based on oracle snapshots. Once the trigger condition is met and recorded, the payout is locked in.
              Subsequent price recovery doesn&apos;t affect policies that already triggered.
            </p>
          </div>
          <div className="faq-item">
            <h3>How are premiums calculated?</h3>
            <p>
              Premiums use actuarial hazard curves that factor in coverage amount, duration, and current market conditions.
              There&apos;s a minimum floor of 0.25% to ensure treasury sustainability.
            </p>
          </div>
          <div className="faq-item">
            <h3>Is the treasury fully collateralized?</h3>
            <p>
              Yes. The TreasuryManager holds sufficient USDC reserves to cover all active policy liabilities.
              Collateralization is verifiable on-chain at any time.
            </p>
          </div>
          <div className="faq-item">
            <h3>Can I cancel my policy early?</h3>
            <p>
              Policies are non-refundable once purchased. This ensures the protocol can maintain adequate reserves
              and prevents adverse selection during volatile periods.
            </p>
          </div>
          <div className="faq-item">
            <h3>Why Base and not Ethereum mainnet?</h3>
            <p>
              Base offers lower transaction costs while maintaining Ethereum security through L2 architecture.
              This makes smaller coverage amounts economically viable.
            </p>
          </div>
          <div className="faq-item">
            <h3>What oracles do you use?</h3>
            <p>
              We use Chainlink&apos;s decentralized oracle network for USDC/USD price feeds. Chainlink is the industry standard
              with proven reliability and manipulation resistance.
            </p>
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
