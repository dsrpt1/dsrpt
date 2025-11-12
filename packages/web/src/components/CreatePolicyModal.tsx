'use client';
import { useState, useEffect } from 'react';
import { parseUnits, formatUnits, type Address } from 'viem';
import { useReadContract } from 'wagmi';
import CyberButton from './CyberButton';
import { hazardCurveAbi } from '@/abis/hazardCurve';
import { ADDRESSES } from '@/lib/addresses';

interface CreatePolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (premium: bigint, payout: bigint, duration: bigint) => Promise<void>;
}

// Default curve ID from deployment (keccak256 hash used in deployment)
const DEFAULT_CURVE_ID = '0x39b093ac4c94c4267dd13ad56b8faca1d0b90cbdc6757b4247b164c12773e3de' as const;

export default function CreatePolicyModal({ isOpen, onClose, onSubmit }: CreatePolicyModalProps) {
  const [payout, setPayout] = useState('1000');
  const [durationDays, setDurationDays] = useState('30');
  const [loading, setLoading] = useState(false);
  const [calculatedPremium, setCalculatedPremium] = useState<bigint>(0n);

  // Get premium from hazard curve
  const payoutWei = parseUnits(payout || '0', 6);
  const { data: premiumFromCurve, isLoading: isPremiumLoading } = useReadContract({
    address: ADDRESSES.base.curve as Address,
    abi: hazardCurveAbi,
    functionName: 'premiumOf',
    args: [DEFAULT_CURVE_ID, payoutWei, BigInt(Number(durationDays) || 0)],
  });

  // Update calculated premium when curve returns data
  useEffect(() => {
    if (premiumFromCurve !== undefined) {
      setCalculatedPremium(premiumFromCurve);
    }
  }, [premiumFromCurve]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Convert to proper units (USDC has 6 decimals)
      const payoutWei = parseUnits(payout, 6);
      const durationSeconds = BigInt(Number(durationDays) * 24 * 60 * 60);

      await onSubmit(calculatedPremium, payoutWei, durationSeconds);
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

            {/* Calculated Premium Display */}
            <div className="p-4 bg-dsrpt-gray-800 border border-dsrpt-cyan-primary/30 rounded">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-bold text-dsrpt-cyan-primary uppercase tracking-wider">
                  Calculated Premium
                </label>
                {isPremiumLoading && (
                  <span className="text-xs text-dsrpt-cyan-secondary animate-pulse">Calculating...</span>
                )}
              </div>
              <div className="text-3xl font-bold text-dsrpt-cyan-primary text-glow">
                {isPremiumLoading ? '---' : formatUnits(calculatedPremium, 6)} USDC
              </div>
              <p className="text-xs text-dsrpt-cyan-dark mt-2 font-mono">
                {'//'} Auto-calculated by hazard curve engine
              </p>
            </div>

            {/* Summary */}
            <div className="p-4 bg-dsrpt-gray-800 border border-dsrpt-cyan-primary/20 rounded">
              <div className="text-xs text-dsrpt-cyan-dark font-mono space-y-1">
                <div>&gt; PREMIUM: {formatUnits(calculatedPremium, 6)} USDC</div>
                <div>&gt; PAYOUT: {payout} USDC</div>
                <div>&gt; DURATION: {durationDays} DAYS</div>
                <div>&gt; MULTIPLIER: {calculatedPremium > 0n ? (Number(payout) / Number(formatUnits(calculatedPremium, 6))).toFixed(2) : '---'}x</div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-4">
              <CyberButton
                variant="primary"
                className="flex-1"
                disabled={loading || isPremiumLoading || calculatedPremium === 0n}
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

            {/* Info Note */}
            <div className="text-xs text-dsrpt-cyan-dark/70 font-mono">
              <div className="mb-1">{'//'} PREMIUM CALCULATION:</div>
              <div className="pl-4">Premium is automatically calculated based on the hazard curve risk model.</div>
              <div className="pl-4">Curve parameters: baseProbPerDay, slopePerDay, minPremiumBps.</div>
              <div className="pl-4">Current formula: (payout × minPremiumBps) / 10,000</div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
