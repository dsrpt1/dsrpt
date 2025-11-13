'use client';

import { useEffect, useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { formatUnits, type Address } from 'viem';
import { ADDRESSES } from '@/lib/addresses';
import { policyManagerAbi } from '@/abis/policyManager';
import CyberCard from '@/components/CyberCard';
import CyberButton from '@/components/CyberButton';
import StatusBadge from '@/components/StatusBadge';
import Link from 'next/link';

interface Policy {
  id: number;
  buyer: string;
  payout: bigint;
  premium: bigint;
  startTs: bigint;
  endTs: bigint;
  resolved: boolean;
}

export default function PoliciesPage() {
  const { address, isConnected } = useAccount();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);

  // Get total number of policies
  const { data: nextPolicyId } = useReadContract({
    address: ADDRESSES.base.pm as Address,
    abi: policyManagerAbi,
    functionName: 'nextPolicyId',
  });

  useEffect(() => {
    if (!isConnected || !address || !nextPolicyId) {
      setLoading(false);
      return;
    }

    // Fetch all policies
    const fetchPolicies = async () => {
      setLoading(true);
      const totalPolicies = Number(nextPolicyId) - 1;
      const userPolicies: Policy[] = [];

      // Fetch each policy
      for (let i = 1; i <= totalPolicies; i++) {
        try {
          const response = await fetch('/api/policy/' + i);
          if (response.ok) {
            const policy = await response.json();
            // Only include policies owned by connected user
            if (policy.buyer.toLowerCase() === address.toLowerCase()) {
              userPolicies.push({
                id: i,
                ...policy
              });
            }
          }
        } catch (error) {
          console.error(`Error fetching policy ${i}:`, error);
        }
      }

      setPolicies(userPolicies);
      setLoading(false);
    };

    fetchPolicies();
  }, [isConnected, address, nextPolicyId]);

  const getPolicyStatus = (policy: Policy): { label: string; status: 'ok' | 'warn' | 'error' } => {
    const now = Math.floor(Date.now() / 1000);

    if (policy.resolved) {
      return { label: 'RESOLVED', status: 'ok' as const };
    }
    if (Number(policy.endTs) > now) {
      return { label: 'ACTIVE', status: 'ok' as const };
    }
    return { label: 'EXPIRED', status: 'warn' as const };
  };

  const formatDate = (timestamp: bigint) => {
    return new Date(Number(timestamp) * 1000).toLocaleString();
  };

  const formatDuration = (startTs: bigint, endTs: bigint) => {
    const durationSeconds = Number(endTs) - Number(startTs);
    const days = Math.floor(durationSeconds / 86400);
    const hours = Math.floor((durationSeconds % 86400) / 3600);

    if (days > 0) {
      return `${days}d ${hours}h`;
    }
    return `${hours}h`;
  };

  if (!isConnected) {
    return (
      <main className="min-h-screen bg-dsrpt-black relative overflow-hidden">
        <div className="absolute inset-0 bg-cyber-grid bg-grid opacity-20 pointer-events-none" />
        <div className="relative z-10 max-w-7xl mx-auto px-6 py-8">
          <div className="text-center py-12">
            <h1 className="text-4xl font-bold text-dsrpt-cyan-primary text-glow-strong uppercase tracking-wider mb-4">
              MY POLICIES
            </h1>
            <p className="text-dsrpt-cyan-secondary mb-8 font-mono">
              {'//'} CONNECT WALLET TO VIEW YOUR POLICIES
            </p>
            <div className="flex justify-center">
              <ConnectButton />
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-dsrpt-black relative overflow-hidden">
      {/* Animated background effects */}
      <div className="absolute inset-0 bg-cyber-grid bg-grid opacity-20 pointer-events-none" />
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-dsrpt-cyan-primary/5 rounded-full blur-3xl" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-dsrpt-accent-blue/5 rounded-full blur-3xl" />

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-4xl font-bold text-dsrpt-cyan-primary text-glow-strong uppercase tracking-wider">
              MY POLICIES
            </h1>
            <Link href="/">
              <CyberButton>Back to Dashboard</CyberButton>
            </Link>
          </div>
          <p className="text-dsrpt-cyan-secondary font-mono text-sm">
            {'//'} YOUR PARAMETRIC INSURANCE POLICIES ON BASE MAINNET
          </p>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <CyberCard glow>
            <div className="text-center">
              <div className="text-3xl font-bold text-dsrpt-cyan-primary font-mono">{policies.length}</div>
              <div className="text-xs text-dsrpt-cyan-secondary uppercase tracking-wider mt-1">Total Policies</div>
            </div>
          </CyberCard>
          <CyberCard glow>
            <div className="text-center">
              <div className="text-3xl font-bold text-green-400 font-mono">
                {policies.filter(p => {
                  const now = Math.floor(Date.now() / 1000);
                  return !p.resolved && Number(p.endTs) > now;
                }).length}
              </div>
              <div className="text-xs text-dsrpt-cyan-secondary uppercase tracking-wider mt-1">Active</div>
            </div>
          </CyberCard>
          <CyberCard glow>
            <div className="text-center">
              <div className="text-3xl font-bold text-yellow-400 font-mono">
                {policies.filter(p => {
                  const now = Math.floor(Date.now() / 1000);
                  return !p.resolved && Number(p.endTs) <= now;
                }).length}
              </div>
              <div className="text-xs text-dsrpt-cyan-secondary uppercase tracking-wider mt-1">Expired</div>
            </div>
          </CyberCard>
          <CyberCard glow>
            <div className="text-center">
              <div className="text-3xl font-bold text-dsrpt-cyan-secondary font-mono">
                {policies.filter(p => p.resolved).length}
              </div>
              <div className="text-xs text-dsrpt-cyan-secondary uppercase tracking-wider mt-1">Resolved</div>
            </div>
          </CyberCard>
        </div>

        {/* Policies List */}
        {loading ? (
          <CyberCard>
            <div className="text-center py-12">
              <div className="text-dsrpt-cyan-primary font-mono animate-pulse">
                Loading policies...
              </div>
            </div>
          </CyberCard>
        ) : policies.length === 0 ? (
          <CyberCard>
            <div className="text-center py-12">
              <div className="text-3xl mb-4">📋</div>
              <h3 className="text-xl font-bold text-dsrpt-cyan-primary uppercase tracking-wider mb-2">
                No Policies Found
              </h3>
              <p className="text-dsrpt-cyan-secondary mb-6 font-mono text-sm">
                {'//'} YOU HAVEN&apos;T CREATED ANY POLICIES YET
              </p>
              <Link href="/">
                <CyberButton variant="primary">Create First Policy</CyberButton>
              </Link>
            </div>
          </CyberCard>
        ) : (
          <div className="space-y-4">
            {policies.map((policy) => {
              const status = getPolicyStatus(policy);

              return (
                <CyberCard key={policy.id} scan>
                  <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
                    {/* Policy ID */}
                    <div>
                      <div className="text-xs text-dsrpt-cyan-dark uppercase tracking-wider mb-1">
                        Policy ID
                      </div>
                      <div className="text-lg font-bold text-dsrpt-cyan-primary font-mono">
                        #{policy.id}
                      </div>
                    </div>

                    {/* Status */}
                    <div>
                      <div className="text-xs text-dsrpt-cyan-dark uppercase tracking-wider mb-1">
                        Status
                      </div>
                      <StatusBadge status={status.status} label={status.label} />
                    </div>

                    {/* Coverage */}
                    <div>
                      <div className="text-xs text-dsrpt-cyan-dark uppercase tracking-wider mb-1">
                        Coverage
                      </div>
                      <div className="text-lg font-bold text-dsrpt-cyan-primary font-mono">
                        ${formatUnits(policy.payout, 6)}
                      </div>
                    </div>

                    {/* Premium Paid */}
                    <div>
                      <div className="text-xs text-dsrpt-cyan-dark uppercase tracking-wider mb-1">
                        Premium Paid
                      </div>
                      <div className="text-lg font-bold text-dsrpt-cyan-primary font-mono">
                        ${formatUnits(policy.premium, 6)}
                      </div>
                    </div>

                    {/* Duration */}
                    <div>
                      <div className="text-xs text-dsrpt-cyan-dark uppercase tracking-wider mb-1">
                        Duration
                      </div>
                      <div className="text-lg font-bold text-dsrpt-cyan-primary font-mono">
                        {formatDuration(policy.startTs, policy.endTs)}
                      </div>
                    </div>

                    {/* Expiry */}
                    <div>
                      <div className="text-xs text-dsrpt-cyan-dark uppercase tracking-wider mb-1">
                        {Number(policy.endTs) > Math.floor(Date.now() / 1000) ? 'Expires' : 'Expired'}
                      </div>
                      <div className="text-sm text-dsrpt-cyan-secondary font-mono">
                        {formatDate(policy.endTs)}
                      </div>
                    </div>
                  </div>

                  {/* Additional Details */}
                  <div className="mt-4 pt-4 border-t border-dsrpt-cyan-primary/10">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                      <div>
                        <span className="text-dsrpt-cyan-dark">&gt; START: </span>
                        <span className="text-dsrpt-cyan-secondary">{formatDate(policy.startTs)}</span>
                      </div>
                      <div>
                        <span className="text-dsrpt-cyan-dark">&gt; PERIL: </span>
                        <span className="text-dsrpt-cyan-secondary">USDC Depeg Protection</span>
                      </div>
                    </div>
                  </div>
                </CyberCard>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
