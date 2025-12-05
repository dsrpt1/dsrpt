// packages/web/src/app/page.tsx
'use client';

import NetworkStatus from '@/components/NetworkStatus';
import { useEffect, useState } from 'react';

export default function Page() {
  const [rpc, setRpc] = useState<string>('');

  useEffect(() => {
    setRpc(process.env.NEXT_PUBLIC_BASE_RPC ?? 'not set');
  }, []);

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
                disabled
                style={{
                  padding: '12px 16px',
                  background: 'rgba(0, 212, 255, 0.1)',
                  border: '1px solid rgba(0, 212, 255, 0.2)',
                  borderRadius: 12,
                  color: 'var(--text-secondary)',
                  cursor: 'not-allowed',
                  textAlign: 'left',
                  fontSize: 14,
                }}
              >
                Create Protection Policy
                <span style={{ display: 'block', fontSize: 12, marginTop: 4, opacity: 0.6 }}>
                  Coming soon
                </span>
              </button>
              <button
                disabled
                style={{
                  padding: '12px 16px',
                  background: 'rgba(168, 85, 247, 0.1)',
                  border: '1px solid rgba(168, 85, 247, 0.2)',
                  borderRadius: 12,
                  color: 'var(--text-secondary)',
                  cursor: 'not-allowed',
                  textAlign: 'left',
                  fontSize: 14,
                }}
              >
                Fund Liquidity Pool
                <span style={{ display: 'block', fontSize: 12, marginTop: 4, opacity: 0.6 }}>
                  Coming soon
                </span>
              </button>
            </div>
          </div>

          {/* Recent Activity */}
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
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Recent Activity</h2>
            </div>
            <div style={{ display: 'grid', gap: 12 }}>
              {[
                { text: 'Contracts deployed & verified on Base', time: 'Live' },
                { text: 'Keeper EOA configured: 0x9813...B74', time: 'Active' },
                { text: 'Oracle adapter connected to Chainlink', time: 'Synced' },
              ].map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 0',
                    borderBottom: i < 2 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                  }}
                >
                  <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{item.text}</span>
                  <span
                    style={{
                      fontSize: 12,
                      padding: '4px 10px',
                      background: 'rgba(34, 197, 94, 0.1)',
                      color: '#4ade80',
                      borderRadius: 6,
                    }}
                  >
                    {item.time}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Environment */}
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
                🔧
              </div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Environment</h2>
            </div>
            <div style={{ display: 'grid', gap: 12 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: 12,
                  background: 'rgba(0, 0, 0, 0.2)',
                  borderRadius: 8,
                }}
              >
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Network</span>
                <code
                  style={{
                    background: 'rgba(0, 212, 255, 0.1)',
                    padding: '4px 10px',
                    borderRadius: 6,
                    fontSize: 13,
                    color: 'var(--accent-cyan)',
                  }}
                >
                  Base (8453)
                </code>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: 12,
                  background: 'rgba(0, 0, 0, 0.2)',
                  borderRadius: 8,
                }}
              >
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>RPC</span>
                <code
                  style={{
                    background: 'rgba(168, 85, 247, 0.1)',
                    padding: '4px 10px',
                    borderRadius: 6,
                    fontSize: 13,
                    color: 'var(--accent-purple)',
                    maxWidth: 180,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {rpc || 'loading...'}
                </code>
              </div>
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
    </main>
  );
}
