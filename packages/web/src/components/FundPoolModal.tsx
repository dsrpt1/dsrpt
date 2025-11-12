'use client';
import { useState } from 'react';
import { parseUnits } from 'viem';
import CyberButton from './CyberButton';

interface FundPoolModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (amount: bigint) => Promise<void>;
  userBalance?: string;
}

export default function FundPoolModal({ isOpen, onClose, onSubmit, userBalance }: FundPoolModalProps) {
  const [amount, setAmount] = useState('100');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Convert to proper units (USDC has 6 decimals)
      const amountWei = parseUnits(amount, 6);
      await onSubmit(amountWei);
      onClose();
    } catch (error) {
      console.error('Error funding pool:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-md">
        <div className="cyber-card bg-dsrpt-gray-900 border-dsrpt-cyan-primary/50">
          <div className="scan-line" />

          {/* Header */}
          <div className="mb-6 pb-4 border-b border-dsrpt-cyan-primary/20">
            <h2 className="text-2xl font-bold text-dsrpt-cyan-primary text-glow uppercase tracking-wider">
              Fund Pool
            </h2>
            <p className="text-xs text-dsrpt-cyan-secondary mt-2 font-mono">
              {'//'} DEPOSIT USDC INTO LIQUIDITY POOL
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Balance Display */}
            {userBalance && (
              <div className="p-3 bg-dsrpt-gray-800 border border-dsrpt-cyan-primary/20 rounded">
                <div className="text-xs text-dsrpt-cyan-secondary uppercase tracking-wider mb-1">
                  Your Balance
                </div>
                <div className="text-lg font-bold text-dsrpt-cyan-primary font-mono">
                  {userBalance} USDC
                </div>
              </div>
            )}

            {/* Amount Input */}
            <div>
              <label className="block text-sm font-bold text-dsrpt-cyan-primary uppercase tracking-wider mb-2">
                Amount (USDC)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="cyber-input w-full"
                placeholder="100.00"
                required
              />
              <p className="text-xs text-dsrpt-cyan-dark mt-1 font-mono">
                {'//'} Deposit to earn fees from policies
              </p>
            </div>

            {/* Quick Amount Buttons */}
            <div className="grid grid-cols-4 gap-2">
              {['10', '50', '100', '500'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAmount(preset)}
                  className="px-3 py-2 bg-dsrpt-gray-800 border border-dsrpt-cyan-primary/30 text-dsrpt-cyan-primary text-xs font-bold hover:bg-dsrpt-cyan-primary/10 transition-all"
                >
                  {preset}
                </button>
              ))}
            </div>

            {/* Info */}
            <div className="p-4 bg-dsrpt-gray-800 border border-dsrpt-cyan-primary/20 rounded">
              <div className="text-xs text-dsrpt-cyan-dark font-mono space-y-1">
                <div>&gt; DEPOSITING: {amount} USDC</div>
                <div>&gt; NOTE: Requires USDC approval</div>
                <div>&gt; POOL SHARE: Proportional to total</div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-4">
              <CyberButton
                variant="primary"
                className="flex-1"
                disabled={loading}
              >
                {loading ? 'Processing...' : 'Deposit'}
              </CyberButton>
              <CyberButton
                type="button"
                onClick={onClose}
                className="flex-1"
                disabled={loading}
              >
                Cancel
              </CyberButton>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
