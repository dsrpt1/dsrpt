'use client';
import { useState } from 'react';
import { parseUnits } from 'viem';
import CyberButton from './CyberButton';

interface CreatePolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (premium: bigint, payout: bigint, duration: bigint) => Promise<void>;
}

export default function CreatePolicyModal({ isOpen, onClose, onSubmit }: CreatePolicyModalProps) {
  const [premium, setPremium] = useState('10');
  const [payout, setPayout] = useState('1000');
  const [durationDays, setDurationDays] = useState('30');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Convert to proper units (USDC has 6 decimals)
      const premiumWei = parseUnits(premium, 6);
      const payoutWei = parseUnits(payout, 6);
      const durationSeconds = BigInt(Number(durationDays) * 24 * 60 * 60);

      await onSubmit(premiumWei, payoutWei, durationSeconds);
      onClose();
    } catch (error) {
      console.error('Error creating policy:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-md">
        {/* Modal */}
        <div className="cyber-card bg-dsrpt-gray-900 border-dsrpt-cyan-primary/50">
          {/* Scan line effect */}
          <div className="scan-line" />

          {/* Header */}
          <div className="mb-6 pb-4 border-b border-dsrpt-cyan-primary/20">
            <h2 className="text-2xl font-bold text-dsrpt-cyan-primary text-glow uppercase tracking-wider">
              Create Policy
            </h2>
            <p className="text-xs text-dsrpt-cyan-secondary mt-2 font-mono">
              {'//'} INITIALIZE PARAMETRIC INSURANCE POLICY
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Premium Input */}
            <div>
              <label className="block text-sm font-bold text-dsrpt-cyan-primary uppercase tracking-wider mb-2">
                Premium (USDC)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={premium}
                onChange={(e) => setPremium(e.target.value)}
                className="cyber-input w-full"
                placeholder="10.00"
                required
              />
              <p className="text-xs text-dsrpt-cyan-dark mt-1 font-mono">
                {'//'} Amount you pay for coverage
              </p>
            </div>

            {/* Payout Input */}
            <div>
              <label className="block text-sm font-bold text-dsrpt-cyan-primary uppercase tracking-wider mb-2">
                Payout (USDC)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={payout}
                onChange={(e) => setPayout(e.target.value)}
                className="cyber-input w-full"
                placeholder="1000.00"
                required
              />
              <p className="text-xs text-dsrpt-cyan-dark mt-1 font-mono">
                {'//'} Amount received if condition met
              </p>
            </div>

            {/* Duration Input */}
            <div>
              <label className="block text-sm font-bold text-dsrpt-cyan-primary uppercase tracking-wider mb-2">
                Duration (Days)
              </label>
              <input
                type="number"
                step="1"
                min="1"
                value={durationDays}
                onChange={(e) => setDurationDays(e.target.value)}
                className="cyber-input w-full"
                placeholder="30"
                required
              />
              <p className="text-xs text-dsrpt-cyan-dark mt-1 font-mono">
                {'//'} Policy coverage period
              </p>
            </div>

            {/* Summary */}
            <div className="p-4 bg-dsrpt-gray-800 border border-dsrpt-cyan-primary/20 rounded">
              <div className="text-xs text-dsrpt-cyan-dark font-mono space-y-1">
                <div>&gt; PREMIUM: {premium} USDC</div>
                <div>&gt; PAYOUT: {payout} USDC</div>
                <div>&gt; DURATION: {durationDays} DAYS</div>
                <div>&gt; MULTIPLIER: {(Number(payout) / Number(premium)).toFixed(2)}x</div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-4">
              <CyberButton
                variant="primary"
                className="flex-1"
                disabled={loading}
              >
                {loading ? 'Creating...' : 'Create Policy'}
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
