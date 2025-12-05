// packages/web/src/app/page.tsx
'use client';

import { useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import NetworkStatus from '@/components/NetworkStatus';
import FundPoolModal from '@/components/FundPoolModal';
import CreatePolicyModal from '@/components/CreatePolicyModal';

export default function Page() {
  const { isConnected } = useAccount();
  const [fundPoolOpen, setFundPoolOpen] = useState(false);
  const [createPolicyOpen, setCreatePolicyOpen] = useState(false);

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '32px 24px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          display: 'grid',
          gap: 24,
        }}
      >
        {/* Header */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            paddingBottom: 16,
            borderBottom: '1px solid rgba(0, 212, 255, 0.15)',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: 32,
                fontWeight: 800,
                background: 'linear-gradient(135deg, #00d4ff 0%, #a855f7 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                letterSpacing: '-0.02em',
              }}
            >
              DSRPT
            </h1>
            <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>
              Depeg Protection Protocol on Base
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                background: 'rgba(34, 197, 94, 0.1)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                borderRadius: 24,
                fontSize: 13,
                color: '#4ade80',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#22c55e',
                  boxShadow: '0 0 8px #22c55e',
                }}
              />
              Mainnet Live
            </div>
            <ConnectButton />
          </div>
        </header>

        {/* Main Grid */}
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
            gap: 20,
          }}
        >
          {/* Network Status Card */}
          <NetworkStatus />

          {/* Quick Actions */}
          <div className="card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.2) 0%, rgba(0, 212, 255, 0.2) 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                }}
              >
                ⚡
              </div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Quick Actions</h2>
            </div>
            <div style={{ display: 'grid', gap: 12 }}>
              <button
                onClick={() => setCreatePolicyOpen(true)}
                disabled={!isConnected}
                style={{
                  padding: '14px 16px',
                  background: isConnected
                    ? 'linear-gradient(135deg, rgba(0, 212, 255, 0.15) 0%, rgba(168, 85, 247, 0.15) 100%)'
                    : 'rgba(0, 212, 255, 0.05)',
                  border: '1px solid rgba(0, 212, 255, 0.3)',
                  borderRadius: 12,
                  color: isConnected ? 'var(--text-primary)' : 'var(--text-secondary)',
                  cursor: isConnected ? 'pointer' : 'not-allowed',
                  textAlign: 'left',
                  fontSize: 14,
                  transition: 'all 0.2s ease',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  🛡️ Create Protection Policy
                </span>
                <span style={{ display: 'block', fontSize: 12, marginTop: 4, opacity: 0.6 }}>
                  {isConnected ? 'Get coverage against USDC depeg' : 'Connect wallet to continue'}
                </span>
              </button>
              <button
                onClick={() => setFundPoolOpen(true)}
                disabled={!isConnected}
                style={{
                  padding: '14px 16px',
                  background: isConnected
                    ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.15) 0%, rgba(0, 212, 255, 0.15) 100%)'
                    : 'rgba(168, 85, 247, 0.05)',
                  border: '1px solid rgba(168, 85, 247, 0.3)',
                  borderRadius: 12,
                  color: isConnected ? 'var(--text-primary)' : 'var(--text-secondary)',
                  cursor: isConnected ? 'pointer' : 'not-allowed',
                  textAlign: 'left',
                  fontSize: 14,
                  transition: 'all 0.2s ease',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  💰 Fund Liquidity Pool
                </span>
                <span style={{ display: 'block', fontSize: 12, marginTop: 4, opacity: 0.6 }}>
                  {isConnected ? 'Deposit USDC to earn yield' : 'Connect wallet to continue'}
                </span>
              </button>
            </div>
          </div>

          {/* Protocol Stats */}
          <div className="card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.2) 0%, rgba(0, 212, 255, 0.2) 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                }}
              >
                📊
              </div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Protocol Info</h2>
            </div>
            <div style={{ display: 'grid', gap: 12 }}>
              {[
                { label: 'Network', value: 'Base Mainnet' },
                { label: 'Asset', value: 'USDC' },
                { label: 'Oracle', value: 'Chainlink USDC/USD' },
                { label: 'Depeg Threshold', value: '< $0.98' },
              ].map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 0',
                    borderBottom: i < 3 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                  }}
                >
                  <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{item.label}</span>
                  <span
                    style={{
                      fontSize: 13,
                      padding: '4px 10px',
                      background: 'rgba(0, 212, 255, 0.1)',
                      color: 'var(--accent-cyan)',
                      borderRadius: 6,
                    }}
                  >
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* How it Works */}
          <div className="card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  background: 'linear-gradient(135deg, rgba(0, 212, 255, 0.2) 0%, rgba(168, 85, 247, 0.2) 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                }}
              >
                💡
              </div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>How It Works</h2>
            </div>
            <div style={{ display: 'grid', gap: 16 }}>
              {[
                { step: '1', title: 'Buy Protection', desc: 'Pay a premium to protect against USDC depeg' },
                { step: '2', title: 'Monitor Price', desc: 'Chainlink oracle tracks USDC/USD price 24/7' },
                { step: '3', title: 'Get Paid', desc: 'If USDC drops below $0.98, claim your payout' },
              ].map((item) => (
                <div key={item.step} style={{ display: 'flex', gap: 12 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #00d4ff 0%, #a855f7 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 13,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {item.step}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{item.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer
          style={{
            color: 'var(--text-muted)',
            fontSize: 12,
            textAlign: 'center',
            marginTop: 16,
            paddingTop: 20,
            borderTop: '1px solid rgba(0, 212, 255, 0.1)',
          }}
        >
          © {new Date().getFullYear()} DSRPT.finance — Depeg Protection Protocol
        </footer>
      </div>

      {/* Modals */}
      <FundPoolModal isOpen={fundPoolOpen} onClose={() => setFundPoolOpen(false)} />
      <CreatePolicyModal isOpen={createPolicyOpen} onClose={() => setCreatePolicyOpen(false)} />
    </main>
  );
}
