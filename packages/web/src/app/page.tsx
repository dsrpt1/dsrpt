// packages/web/src/app/page.tsx
'use client';

import NetworkStatus from '@/components/NetworkStatus';
import { useEffect, useState } from 'react';

export default function Page() {
  const [rpc, setRpc] = useState<string>('');

  useEffect(() => {
    // read env at runtime (client)
    setRpc(process.env.NEXT_PUBLIC_BASE_RPC ?? 'not set');
  }, []);

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#f8fafc',
        padding: '24px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          maxWidth: 1120,
          margin: '0 auto',
          display: 'grid',
          gap: 16,
        }}
      >
        {/* Header */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>
              DSRPT — MVP Console
            </h1>
            <p style={{ margin: '6px 0 0', color: '#6b7280' }}>
              Monitor contracts, oracle feed adapter, and keeper on Base mainnet.
            </p>
          </div>
        </header>

        {/* 2-column grid */}
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: '1.3fr 1fr',
            gap: 16,
          }}
        >
          {/* LEFT */}
          <div style={{ display: 'grid', gap: 16 }}>
            {/* our status card */}
            <NetworkStatus />

            {/* placeholder actions */}
            <section
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 16,
                padding: 16,
                background: '#fff',
                boxShadow:
                  '0 1px 2px rgba(0,0,0,0.04), 0 2px 6px rgba(0,0,0,0.03)',
              }}
            >
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                Quick actions
              </h2>
              <p style={{ marginTop: 8, color: '#6b7280' }}>
                Coming next: create policy, fund pool, trigger oracle check.
              </p>
            </section>
          </div>

          {/* RIGHT */}
          <div style={{ display: 'grid', gap: 16 }}>
            {/* activity */}
            <section
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 16,
                padding: 16,
                background: '#fff',
                boxShadow:
                  '0 1px 2px rgba(0,0,0,0.04), 0 2px 6px rgba(0,0,0,0.03)',
              }}
            >
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                Recent activity
              </h2>
              <ul style={{ marginTop: 10, paddingLeft: 18, color: '#6b7280' }}>
                <li>New contracts deployed & verified on Base</li>
                <li>Keeper EOA online: 0x9813...B74</li>
                <li>USDC on Base configured</li>
              </ul>
            </section>

            {/* env */}
            <section
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 16,
                padding: 16,
                background: '#fff',
                boxShadow:
                  '0 1px 2px rgba(0,0,0,0.04), 0 2px 6px rgba(0,0,0,0.03)',
              }}
            >
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                Environment
              </h2>
              <div style={{ marginTop: 8, color: '#6b7280', fontSize: 14 }}>
                RPC:{' '}
                <code
                  style={{
                    background: '#f1f5f9',
                    padding: '2px 6px',
                    borderRadius: 6,
                  }}
                >
                  {rpc}
                </code>
                <br />
                Network:{' '}
                <code
                  style={{
                    background: '#f1f5f9',
                    padding: '2px 6px',
                    borderRadius: 6,
                  }}
                >
                  Base (chainId 8453)
                </code>
              </div>
            </section>
          </div>
        </section>

        {/* footer */}
        <footer
          style={{
            color: '#94a3b8',
            fontSize: 12,
            textAlign: 'center',
            marginTop: 8,
          }}
        >
          © {new Date().getFullYear()} DSRPT.finance — MVP
        </footer>
      </div>
    </main>
  );
}
