// packages/web/src/app/page.tsx
'use client';

import NetworkStatus from '@/components/NetworkStatus';
import CyberCard from '@/components/CyberCard';
import CyberButton from '@/components/CyberButton';
import DataMetric from '@/components/DataMetric';
import RiskMeter from '@/components/RiskMeter';
import { useEffect, useState } from 'react';

export default function Page() {
  const [rpc, setRpc] = useState<string>('');

  useEffect(() => {
    // read env at runtime (client)
    setRpc(process.env.NEXT_PUBLIC_BASE_RPC ?? 'not set');
  }, []);

  return (
    <main className="min-h-screen bg-dsrpt-black relative overflow-hidden">
      {/* Animated background effects */}
      <div className="absolute inset-0 bg-cyber-grid bg-grid opacity-20 pointer-events-none" />
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-dsrpt-cyan-primary/5 rounded-full blur-3xl" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-dsrpt-accent-blue/5 rounded-full blur-3xl" />

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-8">
        {/* Hero Section */}
        <section className="mb-12 text-center py-12">
          <h1 className="text-5xl md:text-7xl font-bold text-dsrpt-cyan-primary text-glow-strong uppercase tracking-wider mb-4">
            DSRPT COMMAND CENTER
          </h1>
          <p className="text-dsrpt-cyan-secondary text-lg font-mono uppercase tracking-wider">
            {'//'} MONITORING PARAMETRIC RISK PROTOCOL ON BASE MAINNET
          </p>
          <div className="mt-6 flex items-center justify-center gap-4">
            <div className="px-4 py-2 bg-dsrpt-gray-800 border border-dsrpt-cyan-primary/30 rounded clip-corner-tr">
              <span className="text-xs text-dsrpt-cyan-primary font-mono uppercase tracking-wider">
                CHAIN ID: 8453
              </span>
            </div>
            <div className="px-4 py-2 bg-dsrpt-gray-800 border border-dsrpt-cyan-primary/30 rounded clip-corner-tl">
              <span className="text-xs text-dsrpt-cyan-primary font-mono uppercase tracking-wider">
                NETWORK: BASE
              </span>
            </div>
          </div>
        </section>

        {/* Risk Overview Dashboard */}
        <section className="mb-8">
          <h2 className="text-2xl font-bold text-dsrpt-cyan-primary uppercase tracking-wider mb-6 flex items-center gap-3">
            <span className="w-2 h-2 bg-dsrpt-cyan-primary rounded-full animate-pulse" />
            RISK METRICS OVERVIEW
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <CyberCard glow>
              <DataMetric
                label="Total Value Locked"
                value="$0.00"
                subValue="USDC"
                trend="neutral"
              />
            </CyberCard>

            <CyberCard glow>
              <DataMetric
                label="Active Policies"
                value="0"
                subValue="DEPLOYED"
                trend="neutral"
              />
            </CyberCard>

            <CyberCard glow>
              <DataMetric
                label="Pool Utilization"
                value="0%"
                subValue="CAPACITY"
                trend="neutral"
              />
            </CyberCard>

            <CyberCard glow>
              <DataMetric
                label="System Status"
                value="LIVE"
                subValue="ALL SYSTEMS OPERATIONAL"
                trend="up"
              />
            </CyberCard>
          </div>

          {/* Risk Meters */}
          <CyberCard className="mb-8">
            <h3 className="text-lg font-bold text-dsrpt-cyan-primary uppercase tracking-wider mb-6">
              PARAMETRIC RISK ANALYSIS
            </h3>
            <div className="space-y-6">
              <RiskMeter value={0} label="LIQUIDATION RISK" />
              <RiskMeter value={0} label="ORACLE VARIANCE" />
              <RiskMeter value={0} label="PROTOCOL UTILIZATION" />
            </div>
          </CyberCard>
        </section>

        {/* Main Grid Layout */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT - Network Status (spans 2 columns) */}
          <div className="lg:col-span-2 space-y-6">
            <NetworkStatus />

            {/* Quick Actions */}
            <CyberCard>
              <h2 className="text-xl font-bold text-dsrpt-cyan-primary uppercase tracking-wider mb-6 flex items-center gap-2">
                <span className="text-2xl">⚡</span>
                QUICK ACTIONS
              </h2>
              <p className="text-dsrpt-cyan-secondary mb-6 font-mono text-sm">
                {'//'} INITIALIZE PROTOCOL OPERATIONS
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <CyberButton variant="primary">
                  CREATE POLICY
                </CyberButton>
                <CyberButton>
                  FUND POOL
                </CyberButton>
                <CyberButton>
                  ORACLE CHECK
                </CyberButton>
              </div>
              <div className="mt-6 p-4 bg-dsrpt-gray-800 border border-dsrpt-cyan-primary/20 rounded">
                <p className="text-xs text-dsrpt-cyan-dark font-mono">
                  &gt; AWAITING USER INPUT...<br />
                  &gt; CONNECT WALLET TO ENABLE PROTOCOL INTERACTIONS
                </p>
              </div>
            </CyberCard>
          </div>

          {/* RIGHT - Activity and Environment */}
          <div className="space-y-6">
            {/* Recent Activity */}
            <CyberCard scan>
              <h2 className="text-xl font-bold text-dsrpt-cyan-primary uppercase tracking-wider mb-6">
                SYSTEM LOG
              </h2>
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 bg-dsrpt-gray-800/50 border-l-2 border-dsrpt-success">
                  <div className="w-2 h-2 bg-dsrpt-success rounded-full mt-1.5 animate-pulse-slow" />
                  <div>
                    <div className="text-xs text-dsrpt-cyan-primary font-mono">DEPLOYMENT</div>
                    <div className="text-xs text-dsrpt-cyan-secondary mt-1">
                      Contracts deployed & verified on Base
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-dsrpt-gray-800/50 border-l-2 border-dsrpt-success">
                  <div className="w-2 h-2 bg-dsrpt-success rounded-full mt-1.5 animate-pulse-slow" />
                  <div>
                    <div className="text-xs text-dsrpt-cyan-primary font-mono">KEEPER</div>
                    <div className="text-xs text-dsrpt-cyan-secondary mt-1">
                      Keeper EOA online: 0x9813...B74
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-dsrpt-gray-800/50 border-l-2 border-dsrpt-success">
                  <div className="w-2 h-2 bg-dsrpt-success rounded-full mt-1.5 animate-pulse-slow" />
                  <div>
                    <div className="text-xs text-dsrpt-cyan-primary font-mono">CONFIG</div>
                    <div className="text-xs text-dsrpt-cyan-secondary mt-1">
                      USDC on Base configured
                    </div>
                  </div>
                </div>
              </div>
            </CyberCard>

            {/* Environment */}
            <CyberCard>
              <h2 className="text-xl font-bold text-dsrpt-cyan-primary uppercase tracking-wider mb-6">
                ENVIRONMENT
              </h2>
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-dsrpt-cyan-secondary uppercase tracking-wider mb-2">
                    RPC ENDPOINT
                  </div>
                  <code className="block text-xs bg-dsrpt-gray-800 border border-dsrpt-cyan-primary/20 rounded px-3 py-2 text-dsrpt-cyan-primary font-mono break-all">
                    {rpc}
                  </code>
                </div>

                <div>
                  <div className="text-xs text-dsrpt-cyan-secondary uppercase tracking-wider mb-2">
                    NETWORK
                  </div>
                  <code className="block text-xs bg-dsrpt-gray-800 border border-dsrpt-cyan-primary/20 rounded px-3 py-2 text-dsrpt-cyan-primary font-mono">
                    Base (chainId 8453)
                  </code>
                </div>

                <div className="pt-4 border-t border-dsrpt-cyan-primary/10">
                  <div className="text-xs text-dsrpt-cyan-dark font-mono">
                    &gt; PROTOCOL_VERSION: v1.0.0<br />
                    &gt; STATUS: OPERATIONAL<br />
                    &gt; UPTIME: 100%
                  </div>
                </div>
              </div>
            </CyberCard>
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-12 pt-8 border-t border-dsrpt-cyan-primary/10 text-center">
          <p className="text-xs text-dsrpt-cyan-dark font-mono uppercase tracking-wider">
            © {new Date().getFullYear()} DSRPT.FINANCE — PARAMETRIC RISK PROTOCOL — ALL SYSTEMS OPERATIONAL
          </p>
        </footer>
      </div>
    </main>
  );
}
