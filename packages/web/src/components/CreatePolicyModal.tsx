'use client';
import { useState, useEffect, useCallback } from 'react';
import { parseUnits } from 'viem';
import CyberButton from './CyberButton';
import type { PriceBreakdown } from '@/lib/risk/price';
import type { RegimeDetectionResult } from '@/lib/risk/regimeDetector';

interface CreatePolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (premium: bigint, payout: bigint, duration: bigint) => Promise<void>;
}

type QuoteResponse = {
  success: boolean;
  quote?: PriceBreakdown;
  regime_detection?: RegimeDetectionResult;
  error?: string;
};

export default function CreatePolicyModal({ isOpen, onClose, onSubmit }: CreatePolicyModalProps) {
  const [payout, setPayout] = useState('1000');
  const [durationDays, setDurationDays] = useState('30');
  const [loading, setLoading] = useState(false);
  const [isPremiumLoading, setIsPremiumLoading] = useState(false);
  const [priceBreakdown, setPriceBreakdown] = useState<PriceBreakdown | null>(null);
  const [regimeDetection, setRegimeDetection] = useState<RegimeDetectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);

  // Fetch premium from API (regime auto-detected)
  const fetchPremium = useCallback(async () => {
    if (!payout || !durationDays || Number(payout) <= 0 || Number(durationDays) <= 0) {
      setPriceBreakdown(null);
      setRegimeDetection(null);
      return;
    }

    setIsPremiumLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          peril_id: 'usdc-depeg',
          limit_usd: Number(payout),
          tenor_days: Number(durationDays),
          attachment_pct: 0,
          portfolio: {
            utilization: 0.5,
            tvar99_headroom_usd: Number(payout) * 10,
          },
        }),
      });

      const data: QuoteResponse = await response.json();

      if (data.success && data.quote && data.regime_detection) {
        setPriceBreakdown(data.quote);
        setRegimeDetection(data.regime_detection);
      } else {
        setError(data.error || 'Failed to calculate premium');
        setPriceBreakdown(null);
        setRegimeDetection(null);
      }
    } catch (err) {
      console.error('Error fetching premium:', err);
      setError('Network error calculating premium');
      setPriceBreakdown(null);
      setRegimeDetection(null);
    } finally {
      setIsPremiumLoading(false);
    }
  }, [payout, durationDays]);

  // Fetch premium when inputs change
  useEffect(() => {
    if (isOpen) {
      fetchPremium();
    }
  }, [isOpen, fetchPremium]);

  if (!isOpen) return null;

  const premium = priceBreakdown?.premium || 0;
  const premiumWei = parseUnits(premium.toFixed(6), 6);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!priceBreakdown) return;

    setLoading(true);
    try {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-2xl my-8">
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
              {'//'} ACTUARIALLY PRICED PARAMETRIC INSURANCE
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Payout Input */}
              <div>
                <label className="block text-sm font-bold text-dsrpt-cyan-primary uppercase tracking-wider mb-2">
                  Coverage Limit (USDC)
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
                  {'//'} Maximum payout if triggered
                </p>
              </div>

              {/* Duration Input */}
              <div>
                <label className="block text-sm font-bold text-dsrpt-cyan-primary uppercase tracking-wider mb-2">
                  Tenor (Days)
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
            </div>

            {/* Auto-Detected Regime Display */}
            {regimeDetection && (
              <div className="p-4 bg-dsrpt-gray-800 border border-dsrpt-cyan-primary/30 rounded">
                <label className="block text-sm font-bold text-dsrpt-cyan-primary uppercase tracking-wider mb-2">
                  Detected Market Regime
                </label>
                <div className="flex items-center justify-between">
                  <div className="text-2xl font-bold uppercase tracking-wider">
                    <span
                      className={
                        regimeDetection.regime === 'calm'
                          ? 'text-green-400'
                          : regimeDetection.regime === 'volatile'
                          ? 'text-yellow-400'
                          : 'text-red-400'
                      }
                    >
                      {regimeDetection.regime}
                    </span>
                  </div>
                  <div className="text-xs text-dsrpt-cyan-dark font-mono">
                    Confidence: {regimeDetection.confidence.toUpperCase()}
                  </div>
                </div>
                <p className="text-xs text-dsrpt-cyan-dark mt-2 font-mono">
                  {'//'} {regimeDetection.reason}
                </p>
                <p className="text-xs text-dsrpt-cyan-dark/70 mt-1 font-mono">
                  {'//'} Auto-detected from on-chain oracle (updated: {new Date(regimeDetection.updatedAt * 1000).toLocaleTimeString()})
                </p>
              </div>
            )}

            {/* Error Display */}
            {error && (
              <div className="p-4 bg-red-900/20 border border-red-500/50 rounded">
                <p className="text-sm text-red-400 font-mono">{error}</p>
              </div>
            )}

            {/* Calculated Premium Display */}
            <div className="p-4 bg-dsrpt-gray-800 border border-dsrpt-cyan-primary/30 rounded">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-bold text-dsrpt-cyan-primary uppercase tracking-wider">
                  Total Premium
                </label>
                {isPremiumLoading && (
                  <span className="text-xs text-dsrpt-cyan-secondary animate-pulse">Calculating...</span>
                )}
              </div>
              <div className="text-3xl font-bold text-dsrpt-cyan-primary text-glow">
                {isPremiumLoading || !priceBreakdown
                  ? '---'
                  : `${premium.toFixed(2)} USDC`}
              </div>
              <p className="text-xs text-dsrpt-cyan-dark mt-2 font-mono">
                {'//'} GPD + Hawkes actuarial pricing
              </p>

              {/* Breakdown Toggle */}
              {priceBreakdown && (
                <button
                  type="button"
                  onClick={() => setShowBreakdown(!showBreakdown)}
                  className="mt-3 text-xs text-dsrpt-cyan-secondary hover:text-dsrpt-cyan-primary transition-colors font-mono"
                >
                  {showBreakdown ? '[-] Hide' : '[+] Show'} Breakdown
                </button>
              )}
            </div>

            {/* Premium Breakdown */}
            {showBreakdown && priceBreakdown && (
              <div className="p-4 bg-dsrpt-gray-800 border border-dsrpt-cyan-primary/20 rounded space-y-2">
                <div className="text-xs font-bold text-dsrpt-cyan-primary uppercase tracking-wider mb-3">
                  Premium Components
                </div>
                <div className="text-xs text-dsrpt-cyan-dark font-mono space-y-1">
                  <div className="flex justify-between">
                    <span>&gt; Expected Loss (EL):</span>
                    <span className="text-dsrpt-cyan-secondary">${priceBreakdown.EL.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>&gt; Risk Load (RL):</span>
                    <span className="text-dsrpt-cyan-secondary">${priceBreakdown.RL.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>&gt; Capital Load (CL):</span>
                    <span className="text-dsrpt-cyan-secondary">${priceBreakdown.CL.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>&gt; Liquidity Load (LL):</span>
                    <span className="text-dsrpt-cyan-secondary">${priceBreakdown.LL.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>&gt; Overhead (O/H):</span>
                    <span className="text-dsrpt-cyan-secondary">${priceBreakdown.O_H.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-dsrpt-cyan-primary/20 font-bold text-dsrpt-cyan-primary">
                    <span>&gt; TOTAL:</span>
                    <span>${premium.toFixed(2)}</span>
                  </div>
                </div>

                {/* Metadata */}
                {priceBreakdown.metadata && (
                  <div className="mt-4 pt-4 border-t border-dsrpt-cyan-primary/10 text-xs text-dsrpt-cyan-dark/70 font-mono space-y-1">
                    <div>&gt; Trigger Prob: {(priceBreakdown.metadata.trigger_prob * 100).toFixed(2)}%</div>
                    <div>&gt; E[Payout|Trigger]: {(priceBreakdown.metadata.expected_payout_given_trigger * 100).toFixed(2)}%</div>
                    <div>&gt; λ_eff: {priceBreakdown.metadata.hawkes_lambda_eff.toFixed(6)} /day</div>
                  </div>
                )}
              </div>
            )}

            {/* Summary */}
            <div className="p-4 bg-dsrpt-gray-800 border border-dsrpt-cyan-primary/20 rounded">
              <div className="text-xs text-dsrpt-cyan-dark font-mono space-y-1">
                <div>&gt; PREMIUM: {premium.toFixed(2)} USDC</div>
                <div>&gt; COVERAGE: {payout} USDC</div>
                <div>&gt; TENOR: {durationDays} DAYS</div>
                {regimeDetection && (
                  <div>&gt; REGIME: {regimeDetection.regime.toUpperCase()} (auto-detected)</div>
                )}
                <div>&gt; MULTIPLIER: {premium > 0 ? (Number(payout) / premium).toFixed(2) : '---'}x</div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-4">
              <CyberButton
                variant="primary"
                className="flex-1"
                disabled={loading || isPremiumLoading || !priceBreakdown}
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
              <div className="mb-1">{'//'} ACTUARIAL PRICING MODEL:</div>
              <div className="pl-4">• Peaks-Over-Threshold (POT) with GPD tail modeling</div>
              <div className="pl-4">• Hawkes self-exciting process for event clustering</div>
              <div className="pl-4">• Premium = EL + RL + CL + LL + O/H</div>
              <div className="pl-4">• EL = Limit × p_trigger(T) × E[g(I) | I&gt;u]</div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
