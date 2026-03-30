'use client';

import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import { useState } from 'react';
import Navigation from '@/components/Navigation';
import { ConnectButton } from '@rainbow-me/rainbowkit';

const tiers = [
  {
    name: 'Free',
    price: '$0',
    period: '',
    description: 'Public signal data and research access',
    features: [
      'Market composite signal',
      'USDC regime status',
      '7-day history',
      'Research & methodology',
    ],
    cta: 'Get Started',
    ctaLink: '/sign-up',
    highlight: false,
  },
  {
    name: 'Pro',
    price: '$99',
    period: '/month',
    description: 'Full dashboard, real-time charts, and API access',
    features: [
      'All tracked assets (USDC, USDT, DAI, FDUSD, PYUSD)',
      'Real-time signal charts',
      '90-day history',
      'API access (60 req/min)',
      'Telegram & webhook alerts',
      'Regime transition notifications',
    ],
    cta: 'Upgrade to Pro',
    ctaAction: 'checkout',
    highlight: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    description: 'Custom integrations, dedicated support, white-label feeds',
    features: [
      'Everything in Pro',
      'Custom watchlists',
      'Full historical backtest data',
      'Higher API rate limits (300 req/min)',
      'Custom alert thresholds',
      'Dedicated support',
      'White-labeled data feeds',
    ],
    cta: 'Contact Us',
    ctaLink: 'mailto:daniel@cooktradingcorp.com',
    highlight: false,
  },
];

export default function PricingPage() {
  const { isSignedIn } = useUser();
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/checkout', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setLoading(false);
    }
  };

  return (
    <main className="landing-page">
      <header className="top-bar">
        <div className="logo-section">
          <div className="logo-mark">
            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M16 2L4 8v16l12 6 12-6V8L16 2z" stroke="url(#lg2)" strokeWidth="2" fill="none"/>
              <circle cx="16" cy="16" r="4" fill="url(#lg2)"/>
              <defs>
                <linearGradient id="lg2" x1="0" y1="0" x2="32" y2="32">
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

      <section className="pricing-section">
        <h1 className="pricing-title">Pricing</h1>
        <p className="pricing-sub">Choose the plan that fits your risk monitoring needs</p>

        <div className="pricing-grid">
          {tiers.map(tier => (
            <div key={tier.name} className={`pricing-card ${tier.highlight ? 'highlighted' : ''}`}>
              <div className="pricing-card-header">
                <h3>{tier.name}</h3>
                <div className="pricing-price">
                  <span className="price-amount">{tier.price}</span>
                  {tier.period && <span className="price-period">{tier.period}</span>}
                </div>
                <p className="pricing-desc">{tier.description}</p>
              </div>

              <ul className="pricing-features">
                {tier.features.map(f => (
                  <li key={f}>
                    <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/>
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>

              {'ctaAction' in tier && tier.ctaAction === 'checkout' ? (
                <button
                  className="pricing-cta primary"
                  onClick={isSignedIn ? handleCheckout : undefined}
                  disabled={loading}
                >
                  {loading ? 'Redirecting...' : (isSignedIn ? tier.cta : 'Sign in to upgrade')}
                </button>
              ) : 'ctaLink' in tier ? (
                <Link href={tier.ctaLink || '#'} className="pricing-cta">
                  {tier.cta}
                </Link>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <style jsx>{`
        .pricing-section {
          max-width: 1100px;
          margin: 0 auto;
          padding: 64px 24px;
          text-align: center;
        }
        .pricing-title {
          font-size: 42px;
          font-weight: 800;
          color: var(--text-primary);
          margin-bottom: 12px;
        }
        .pricing-sub {
          font-size: 18px;
          color: var(--text-secondary);
          margin-bottom: 48px;
        }
        .pricing-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 24px;
          text-align: left;
        }
        .pricing-card {
          background: var(--bg-panel);
          border: 1px solid var(--border-subtle);
          border-radius: 16px;
          padding: 32px;
          display: flex;
          flex-direction: column;
        }
        .pricing-card.highlighted {
          border-color: rgba(0, 212, 255, 0.4);
          box-shadow: 0 0 32px rgba(0, 212, 255, 0.08);
        }
        .pricing-card-header {
          margin-bottom: 24px;
        }
        .pricing-card-header h3 {
          font-size: 20px;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 8px;
        }
        .pricing-price {
          display: flex;
          align-items: baseline;
          gap: 4px;
          margin-bottom: 8px;
        }
        .price-amount {
          font-size: 36px;
          font-weight: 800;
          color: var(--text-primary);
        }
        .price-period {
          font-size: 14px;
          color: var(--text-secondary);
        }
        .pricing-desc {
          font-size: 14px;
          color: var(--text-secondary);
          line-height: 1.5;
        }
        .pricing-features {
          list-style: none;
          padding: 0;
          flex: 1;
          margin-bottom: 24px;
        }
        .pricing-features li {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 0;
          font-size: 14px;
          color: var(--text-secondary);
        }
        .pricing-features li svg {
          color: #22c55e;
          flex-shrink: 0;
        }
        .pricing-cta {
          display: block;
          text-align: center;
          padding: 14px 24px;
          border-radius: 10px;
          font-size: 15px;
          font-weight: 600;
          border: 1px solid var(--border-subtle);
          background: transparent;
          color: var(--text-primary);
          cursor: pointer;
          transition: all 0.2s;
          text-decoration: none;
        }
        .pricing-cta:hover {
          border-color: rgba(0, 212, 255, 0.3);
          background: rgba(0, 212, 255, 0.05);
          color: var(--text-primary);
        }
        .pricing-cta.primary {
          background: linear-gradient(135deg, #00d4ff 0%, #a855f7 100%);
          border: none;
          color: #0a0a0f;
        }
        .pricing-cta.primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(0, 212, 255, 0.3);
          color: #0a0a0f;
        }
      `}</style>
    </main>
  );
}
