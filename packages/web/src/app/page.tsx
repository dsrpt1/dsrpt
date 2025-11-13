// packages/web/src/app/page.tsx
'use client';

import NetworkStatus from '@/components/NetworkStatus';
import CyberCard from '@/components/CyberCard';
import CyberButton from '@/components/CyberButton';
import DataMetric from '@/components/DataMetric';
import RiskMeter from '@/components/RiskMeter';
import CreatePolicyModal from '@/components/CreatePolicyModal';
import FundPoolModal from '@/components/FundPoolModal';
import OracleCheckModal from '@/components/OracleCheckModal';
import { useEffect, useState } from 'react';
import { useAccount, useWriteContract, useReadContract } from 'wagmi';
import { formatUnits, type Address } from 'viem';
import { ADDRESSES } from '@/lib/addresses';
import { policyManagerAbi } from '@/abis/policyManager';
import { liquidityPoolAbi } from '@/abis/liquidityPool';
import { erc20Abi } from '@/abis/erc20';

export default function Page() {
  const [rpc, setRpc] = useState<string>('');
  const [isPolicyModalOpen, setIsPolicyModalOpen] = useState(false);
  const [isFundModalOpen, setIsFundModalOpen] = useState(false);
  const [isOracleModalOpen, setIsOracleModalOpen] = useState(false);
  const [txStatus, setTxStatus] = useState<string>('');

  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();

  // Read user USDC balance
  const { data: usdcBalance } = useReadContract({
    address: ADDRESSES.base.usdc as Address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
  });

  // Read pool USDC balance
  const { data: poolBalance } = useReadContract({
    address: ADDRESSES.base.usdc as Address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [ADDRESSES.base.pool as Address],
  });

  // Read next policy ID
  const { data: nextPolicyId } = useReadContract({
    address: ADDRESSES.base.pm as Address,
    abi: policyManagerAbi,
    functionName: 'nextPolicyId',
  });

  useEffect(() => {
    setRpc(process.env.NEXT_PUBLIC_RPC_URL ?? process.env.NEXT_PUBLIC_BASE_RPC ?? 'not set');
  }, []);

  const handleCreatePolicy = async (premium: bigint, payout: bigint, duration: bigint) => {
    if (!isConnected) {
      alert('Please connect your wallet first');
      return;
    }

    try {
      setTxStatus('Creating policy...');
      const hash = await writeContractAsync({
        address: ADDRESSES.base.pm as Address,
        abi: policyManagerAbi,
        functionName: 'createPolicy',
        args: [premium, payout, duration],
      });

      setTxStatus(`Transaction sent: ${hash.slice(0, 10)}...`);
      setTimeout(() => setTxStatus(''), 5000);
    } catch (error) {
      console.error('Create policy error:', error);
      setTxStatus('Error creating policy');
      setTimeout(() => setTxStatus(''), 5000);
      throw error;
    }
  };

  const handleFundPool = async (amount: bigint) => {
    if (!isConnected || !address) {
      alert('Please connect your wallet first');
      return;
    }

    try {
      // First approve USDC
      setTxStatus('Approving USDC...');
      const approveHash = await writeContractAsync({
        address: ADDRESSES.base.usdc as Address,
        abi: erc20Abi,
        functionName: 'approve',
        args: [ADDRESSES.base.pool as Address, amount],
      });

      setTxStatus(`Approval sent: ${approveHash.slice(0, 10)}...`);

      // Wait a bit for approval to confirm
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Then deposit using ERC-4626 deposit(assets, receiver)
      setTxStatus('Depositing to pool...');
      const depositHash = await writeContractAsync({
        address: ADDRESSES.base.pool as Address,
        abi: liquidityPoolAbi,
        functionName: 'deposit',
        args: [amount, address], // ERC-4626: deposit(assets, receiver)
      });

      setTxStatus(`Deposit sent: ${depositHash.slice(0, 10)}...`);
      setTimeout(() => setTxStatus(''), 5000);
    } catch (error) {
      console.error('Fund pool error:', error);
      setTxStatus('Error funding pool');
      setTimeout(() => setTxStatus(''), 5000);
      throw error;
    }
  };

  const handleOracleCheck = async () => {
    try {
      // Read oracle data
      const [priceData, threshold, maxStale] = await Promise.all([
        fetch(`${rpc}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_call',
            params: [{
              to: ADDRESSES.base.adapter,
              data: '0x' + '50d25bcd' + '0'.repeat(64), // latestPrice(bytes32(0))
            }, 'latest'],
            id: 1,
          }),
        }).then(r => r.json()),
        fetch(`${rpc}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_call',
            params: [{
              to: ADDRESSES.base.adapter,
              data: '0xaced1661', // threshold1e8()
            }, 'latest'],
            id: 2,
          }),
        }).then(r => r.json()),
        fetch(`${rpc}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_call',
            params: [{
              to: ADDRESSES.base.adapter,
              data: '0x32c2d153', // maxStale()
            }, 'latest'],
            id: 3,
          }),
        }).then(r => r.json()),
      ]);

      // Check for RPC errors
      if (priceData.error) {
        throw new Error(`RPC Error: ${priceData.error.message || 'Failed to fetch price'}`);
      }
      if (threshold.error) {
        throw new Error(`RPC Error: ${threshold.error.message || 'Failed to fetch threshold'}`);
      }
      if (maxStale.error) {
        throw new Error(`RPC Error: ${maxStale.error.message || 'Failed to fetch maxStale'}`);
      }

      // Check if results exist
      if (!priceData.result || !threshold.result || !maxStale.result) {
        throw new Error('Invalid response from oracle - missing result data');
      }

      // Parse results
      const price = parseInt(priceData.result.slice(0, 66), 16) / 1e8;
      const thresholdVal = parseInt(threshold.result, 16) / 1e8;
      const maxStaleVal = parseInt(maxStale.result, 16);
      const updatedAt = parseInt(priceData.result.slice(66), 16);
      const now = Math.floor(Date.now() / 1000);

      return {
        price: price.toFixed(4),
        threshold: thresholdVal.toFixed(4),
        updatedAt: new Date(updatedAt * 1000).toLocaleString(),
        maxStale: maxStaleVal.toString(),
        isStale: now - updatedAt > maxStaleVal,
        belowThreshold: price < thresholdVal,
      };
    } catch (error) {
      console.error('Oracle check error:', error);
      throw error;
    }
  };

  const formattedBalance = usdcBalance ? formatUnits(usdcBalance, 6) : '0';
  const formattedPoolBalance = poolBalance ? formatUnits(poolBalance, 6) : '0';
  const activePolicies = nextPolicyId ? Number(nextPolicyId) - 1 : 0;

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

        {/* Transaction Status */}
        {txStatus && (
          <div className="mb-6 p-4 bg-dsrpt-cyan-primary/10 border border-dsrpt-cyan-primary/30 rounded text-center">
            <p className="text-sm text-dsrpt-cyan-primary font-mono uppercase tracking-wider">
              {txStatus}
            </p>
          </div>
        )}

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
                value={`$${formattedPoolBalance}`}
                subValue="USDC"
                trend="neutral"
              />
            </CyberCard>

            <CyberCard glow>
              <DataMetric
                label="Active Policies"
                value={activePolicies.toString()}
                subValue="DEPLOYED"
                trend="neutral"
              />
            </CyberCard>

            <CyberCard glow>
              <DataMetric
                label="Your Balance"
                value={`${formattedBalance}`}
                subValue="USDC"
                trend="neutral"
              />
            </CyberCard>

            <CyberCard glow>
              <DataMetric
                label="System Status"
                value={isConnected ? "CONNECTED" : "DISCONNECTED"}
                subValue={isConnected ? "WALLET ACTIVE" : "CONNECT WALLET"}
                trend={isConnected ? "up" : "neutral"}
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
                <CyberButton
                  variant="primary"
                  onClick={() => setIsPolicyModalOpen(true)}
                  disabled={!isConnected}
                >
                  CREATE POLICY
                </CyberButton>
                <CyberButton
                  onClick={() => setIsFundModalOpen(true)}
                  disabled={!isConnected}
                >
                  FUND POOL
                </CyberButton>
                <CyberButton
                  onClick={() => setIsOracleModalOpen(true)}
                >
                  ORACLE CHECK
                </CyberButton>
              </div>
              <div className="mt-6 p-4 bg-dsrpt-gray-800 border border-dsrpt-cyan-primary/20 rounded">
                <p className="text-xs text-dsrpt-cyan-dark font-mono">
                  &gt; {isConnected ? 'WALLET CONNECTED - READY FOR OPERATIONS' : 'AWAITING USER INPUT...'}<br />
                  &gt; {isConnected ? `ADDRESS: ${address?.slice(0, 10)}...${address?.slice(-8)}` : 'CONNECT WALLET TO ENABLE PROTOCOL INTERACTIONS'}
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

      {/* Modals */}
      <CreatePolicyModal
        isOpen={isPolicyModalOpen}
        onClose={() => setIsPolicyModalOpen(false)}
        onSubmit={handleCreatePolicy}
      />
      <FundPoolModal
        isOpen={isFundModalOpen}
        onClose={() => setIsFundModalOpen(false)}
        onSubmit={handleFundPool}
        userBalance={formattedBalance}
      />
      <OracleCheckModal
        isOpen={isOracleModalOpen}
        onClose={() => setIsOracleModalOpen(false)}
        onCheck={handleOracleCheck}
      />
    </main>
  );
}
