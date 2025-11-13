'use client';

import { useState } from 'react';
import { useAccount, useReadContract, useWriteContract } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { formatUnits, parseUnits, type Address } from 'viem';
import { ADDRESSES } from '@/lib/addresses';
import { liquidityPoolAbi } from '@/abis/liquidityPool';
import { erc20Abi } from '@/abis/erc20';
import CyberCard from '@/components/CyberCard';
import CyberButton from '@/components/CyberButton';
import DataMetric from '@/components/DataMetric';
import Link from 'next/link';

export default function PoolPage() {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [depositAmount, setDepositAmount] = useState('100');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [txStatus, setTxStatus] = useState('');

  // Read user USDC balance
  const { data: usdcBalance } = useReadContract({
    address: ADDRESSES.base.usdc as Address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
  });

  // Read user LP token balance (shares)
  const { data: lpBalance } = useReadContract({
    address: ADDRESSES.base.pool as Address,
    abi: liquidityPoolAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
  });

  // Read total pool assets
  const { data: totalAssets } = useReadContract({
    address: ADDRESSES.base.pool as Address,
    abi: liquidityPoolAbi,
    functionName: 'totalAssets',
  });

  // Read total LP token supply
  const { data: totalSupply } = useReadContract({
    address: ADDRESSES.base.pool as Address,
    abi: liquidityPoolAbi,
    functionName: 'totalSupply',
  });

  // Calculate user's share of pool
  const userSharePercentage = lpBalance && totalSupply && totalSupply > 0n
    ? (Number(lpBalance) / Number(totalSupply)) * 100
    : 0;

  // Calculate user's withdrawable amount
  const { data: maxWithdrawAmount } = useReadContract({
    address: ADDRESSES.base.pool as Address,
    abi: liquidityPoolAbi,
    functionName: 'maxWithdraw',
    args: address ? [address] : undefined,
  });

  // Preview deposit - how many shares will user get
  const { data: previewDepositShares } = useReadContract({
    address: ADDRESSES.base.pool as Address,
    abi: liquidityPoolAbi,
    functionName: 'previewDeposit',
    args: depositAmount ? [parseUnits(depositAmount, 6)] : undefined,
  });

  // Preview withdraw - how many shares will be burned
  const { data: previewWithdrawShares } = useReadContract({
    address: ADDRESSES.base.pool as Address,
    abi: liquidityPoolAbi,
    functionName: 'previewWithdraw',
    args: withdrawAmount ? [parseUnits(withdrawAmount, 6)] : undefined,
  });

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected || !address) {
      alert('Please connect your wallet first');
      return;
    }

    setLoading(true);
    try {
      const amount = parseUnits(depositAmount, 6);

      // First approve USDC
      setTxStatus('Approving USDC...');
      const approveHash = await writeContractAsync({
        address: ADDRESSES.base.usdc as Address,
        abi: erc20Abi,
        functionName: 'approve',
        args: [ADDRESSES.base.pool as Address, amount],
      });

      setTxStatus(`Approval sent: ${approveHash.slice(0, 10)}...`);
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Then deposit using ERC-4626
      setTxStatus('Depositing to pool...');
      const depositHash = await writeContractAsync({
        address: ADDRESSES.base.pool as Address,
        abi: liquidityPoolAbi,
        functionName: 'deposit',
        args: [amount, address],
      });

      setTxStatus(`Deposit sent: ${depositHash.slice(0, 10)}...`);
      setTimeout(() => {
        setTxStatus('');
        setDepositAmount('100');
      }, 5000);
    } catch (error: unknown) {
      console.error('Deposit error:', error);
      const errorMessage = error instanceof Error
        ? error.message
        : (error as { shortMessage?: string }).shortMessage || 'Transaction failed';
      setTxStatus('Error: ' + errorMessage);
      setTimeout(() => setTxStatus(''), 5000);
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected || !address) {
      alert('Please connect your wallet first');
      return;
    }

    setLoading(true);
    try {
      const amount = parseUnits(withdrawAmount, 6);

      // Withdraw using ERC-4626: withdraw(assets, receiver, owner)
      setTxStatus('Withdrawing from pool...');
      const withdrawHash = await writeContractAsync({
        address: ADDRESSES.base.pool as Address,
        abi: liquidityPoolAbi,
        functionName: 'withdraw',
        args: [amount, address, address],
      });

      setTxStatus(`Withdraw sent: ${withdrawHash.slice(0, 10)}...`);
      setTimeout(() => {
        setTxStatus('');
        setWithdrawAmount('');
      }, 5000);
    } catch (error: unknown) {
      console.error('Withdraw error:', error);
      const errorMessage = error instanceof Error
        ? error.message
        : (error as { shortMessage?: string }).shortMessage || 'Transaction failed';
      setTxStatus('Error: ' + errorMessage);
      setTimeout(() => setTxStatus(''), 5000);
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <main className="min-h-screen bg-dsrpt-black relative overflow-hidden">
        <div className="absolute inset-0 bg-cyber-grid bg-grid opacity-20 pointer-events-none" />
        <div className="relative z-10 max-w-7xl mx-auto px-6 py-8">
          <div className="text-center py-12">
            <h1 className="text-4xl font-bold text-dsrpt-cyan-primary text-glow-strong uppercase tracking-wider mb-4">
              LIQUIDITY POOL
            </h1>
            <p className="text-dsrpt-cyan-secondary mb-8 font-mono">
              {'//'} CONNECT WALLET TO MANAGE YOUR LP POSITION
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
              LIQUIDITY POOL
            </h1>
            <Link href="/">
              <CyberButton>Back to Dashboard</CyberButton>
            </Link>
          </div>
          <p className="text-dsrpt-cyan-secondary font-mono text-sm">
            {'//'} ERC-4626 VAULT FOR PARAMETRIC INSURANCE CAPITAL
          </p>
        </div>

        {/* Transaction Status */}
        {txStatus && (
          <div className="mb-6 p-4 bg-dsrpt-cyan-primary/10 border border-dsrpt-cyan-primary/30 rounded">
            <p className="text-sm text-dsrpt-cyan-primary font-mono">{txStatus}</p>
          </div>
        )}

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <CyberCard glow>
            <DataMetric
              label="Total Pool Value"
              value={`$${totalAssets ? formatUnits(totalAssets, 6) : '0'}`}
              subValue="USDC"
              trend="neutral"
            />
          </CyberCard>
          <CyberCard glow>
            <DataMetric
              label="Your LP Shares"
              value={lpBalance ? formatUnits(lpBalance, 18) : '0'}
              subValue="dLP"
              trend="neutral"
            />
          </CyberCard>
          <CyberCard glow>
            <DataMetric
              label="Your Pool Share"
              value={`${userSharePercentage.toFixed(2)}%`}
              subValue="OF TOTAL POOL"
              trend="neutral"
            />
          </CyberCard>
          <CyberCard glow>
            <DataMetric
              label="Withdrawable"
              value={`$${maxWithdrawAmount ? formatUnits(maxWithdrawAmount, 6) : '0'}`}
              subValue="USDC"
              trend="neutral"
            />
          </CyberCard>
        </div>

        {/* Deposit & Withdraw Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Deposit Form */}
          <CyberCard scan>
            <h2 className="text-2xl font-bold text-dsrpt-cyan-primary uppercase tracking-wider mb-6">
              💰 DEPOSIT
            </h2>
            <form onSubmit={handleDeposit} className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-dsrpt-cyan-primary uppercase tracking-wider mb-2">
                  Amount (USDC)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="cyber-input w-full"
                  placeholder="100.00"
                  required
                />
                <p className="text-xs text-dsrpt-cyan-dark mt-1 font-mono">
                  {'//'} Balance: {usdcBalance ? formatUnits(usdcBalance, 6) : '0'} USDC
                </p>
              </div>

              {previewDepositShares && (
                <div className="p-3 bg-dsrpt-gray-800 border border-dsrpt-cyan-primary/20 rounded">
                  <div className="text-xs text-dsrpt-cyan-dark font-mono space-y-1">
                    <div>&gt; YOU WILL RECEIVE: {formatUnits(previewDepositShares, 18)} dLP</div>
                    <div>&gt; NOTE: Requires USDC approval</div>
                  </div>
                </div>
              )}

              <CyberButton
                variant="primary"
                className="w-full"
                disabled={loading || !depositAmount}
              >
                {loading ? 'Processing...' : 'Deposit USDC'}
              </CyberButton>
            </form>
          </CyberCard>

          {/* Withdraw Form */}
          <CyberCard scan>
            <h2 className="text-2xl font-bold text-dsrpt-cyan-primary uppercase tracking-wider mb-6">
              💸 WITHDRAW
            </h2>
            <form onSubmit={handleWithdraw} className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-dsrpt-cyan-primary uppercase tracking-wider mb-2">
                  Amount (USDC)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  className="cyber-input w-full"
                  placeholder="0.00"
                  required
                />
                <p className="text-xs text-dsrpt-cyan-dark mt-1 font-mono">
                  {'//'} Max: {maxWithdrawAmount ? formatUnits(maxWithdrawAmount, 6) : '0'} USDC
                </p>
              </div>

              {withdrawAmount && previewWithdrawShares && (
                <div className="p-3 bg-dsrpt-gray-800 border border-dsrpt-cyan-primary/20 rounded">
                  <div className="text-xs text-dsrpt-cyan-dark font-mono space-y-1">
                    <div>&gt; WILL BURN: {formatUnits(previewWithdrawShares, 18)} dLP</div>
                    <div>&gt; YOU WILL RECEIVE: {withdrawAmount} USDC</div>
                  </div>
                </div>
              )}

              <CyberButton
                className="w-full"
                disabled={loading || !withdrawAmount || (maxWithdrawAmount && parseUnits(withdrawAmount || '0', 6) > maxWithdrawAmount)}
              >
                {loading ? 'Processing...' : 'Withdraw USDC'}
              </CyberButton>

              {maxWithdrawAmount === 0n && (
                <p className="text-xs text-yellow-400 font-mono text-center">
                  ⚠️ No funds to withdraw
                </p>
              )}
            </form>
          </CyberCard>
        </div>

        {/* Info Section */}
        <CyberCard>
          <h2 className="text-xl font-bold text-dsrpt-cyan-primary uppercase tracking-wider mb-4">
            ℹ️ HOW IT WORKS
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm text-dsrpt-cyan-secondary font-mono">
            <div>
              <h3 className="text-dsrpt-cyan-primary font-bold mb-2">&gt; DEPOSITS</h3>
              <ul className="space-y-1 text-xs">
                <li>• Deposit USDC to earn policy premiums</li>
                <li>• Receive dLP (DSRPT LP) tokens representing your share</li>
                <li>• dLP tokens are ERC-20 compatible</li>
                <li>• Share price increases as premiums accumulate</li>
              </ul>
            </div>
            <div>
              <h3 className="text-dsrpt-cyan-primary font-bold mb-2">&gt; WITHDRAWALS</h3>
              <ul className="space-y-1 text-xs">
                <li>• Burn dLP tokens to withdraw USDC</li>
                <li>• Withdrawable amount = (your dLP / total dLP) × pool assets</li>
                <li>• May be limited if pool is under-capitalized</li>
                <li>• No lock-up period (withdraw anytime)</li>
              </ul>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-dsrpt-cyan-primary/10">
            <div className="text-xs text-dsrpt-cyan-dark font-mono space-y-1">
              <div>&gt; POOL TYPE: ERC-4626 Vault</div>
              <div>&gt; RISK: Payouts reduce pool value during claim events</div>
              <div>&gt; REWARD: Earn premiums from policy sales</div>
              <div>&gt; CONTRACT: {ADDRESSES.base.pool}</div>
            </div>
          </div>
        </CyberCard>
      </div>
    </main>
  );
}
