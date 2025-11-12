'use client';
import { useEffect, useState, useCallback } from 'react';
import CyberButton from './CyberButton';

interface OracleData {
  price: string;
  threshold: string;
  updatedAt: string;
  maxStale: string;
  isStale: boolean;
  belowThreshold: boolean;
}

interface OracleCheckModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCheck: () => Promise<OracleData>;
}

export default function OracleCheckModal({ isOpen, onClose, onCheck }: OracleCheckModalProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<OracleData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkOracle = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await onCheck();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check oracle');
    } finally {
      setLoading(false);
    }
  }, [onCheck]);

  useEffect(() => {
    if (isOpen) {
      checkOracle();
    }
  }, [isOpen, checkOracle]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-md">
        <div className="cyber-card bg-dsrpt-gray-900 border-dsrpt-cyan-primary/50">
          <div className={loading ? 'scan-line' : ''} />

          {/* Header */}
          <div className="mb-6 pb-4 border-b border-dsrpt-cyan-primary/20">
            <h2 className="text-2xl font-bold text-dsrpt-cyan-primary text-glow uppercase tracking-wider">
              Oracle Status
            </h2>
            <p className="text-xs text-dsrpt-cyan-secondary mt-2 font-mono">
              {'//'} CHAINLINK PRICE FEED MONITORING
            </p>
          </div>

          {/* Content */}
          <div className="space-y-4">
            {loading && (
              <div className="text-center py-8">
                <div className="inline-block w-8 h-8 border-2 border-dsrpt-cyan-primary border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-sm text-dsrpt-cyan-secondary uppercase tracking-wider">
                  Querying Oracle...
                </p>
              </div>
            )}

            {error && (
              <div className="p-4 bg-dsrpt-danger/10 border border-dsrpt-danger/30 rounded">
                <p className="text-sm text-dsrpt-danger font-mono">
                  ERROR: {error}
                </p>
              </div>
            )}

            {data && !loading && (
              <div className="space-y-4">
                {/* Price Display */}
                <div className="p-6 bg-dsrpt-gray-800 border border-dsrpt-cyan-primary/30 rounded text-center">
                  <div className="text-xs text-dsrpt-cyan-secondary uppercase tracking-wider mb-2">
                    Current Price
                  </div>
                  <div className="text-4xl font-bold text-dsrpt-cyan-primary text-glow font-mono">
                    ${data.price}
                  </div>
                </div>

                {/* Status Grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-dsrpt-gray-800 border border-dsrpt-cyan-primary/20 rounded">
                    <div className="text-xs text-dsrpt-cyan-secondary uppercase tracking-wider mb-1">
                      Threshold
                    </div>
                    <div className="text-lg font-bold text-dsrpt-cyan-primary font-mono">
                      ${data.threshold}
                    </div>
                  </div>

                  <div className="p-4 bg-dsrpt-gray-800 border border-dsrpt-cyan-primary/20 rounded">
                    <div className="text-xs text-dsrpt-cyan-secondary uppercase tracking-wider mb-1">
                      Status
                    </div>
                    <div className={`text-lg font-bold font-mono ${data.belowThreshold ? 'text-dsrpt-danger' : 'text-dsrpt-success'}`}>
                      {data.belowThreshold ? 'DEPEG' : 'NORMAL'}
                    </div>
                  </div>
                </div>

                {/* Details */}
                <div className="p-4 bg-dsrpt-gray-800 border border-dsrpt-cyan-primary/20 rounded">
                  <div className="text-xs text-dsrpt-cyan-dark font-mono space-y-1">
                    <div>&gt; UPDATED: {data.updatedAt}</div>
                    <div>&gt; MAX STALE: {data.maxStale}s</div>
                    <div>&gt; FEED STATUS: {data.isStale ?
                      <span className="text-dsrpt-warning">STALE</span> :
                      <span className="text-dsrpt-success">FRESH</span>
                    }</div>
                  </div>
                </div>

                {/* Depeg Warning */}
                {data.belowThreshold && (
                  <div className="p-4 bg-dsrpt-danger/10 border-2 border-dsrpt-danger/50 rounded">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-dsrpt-danger text-2xl">⚠</span>
                      <span className="text-sm font-bold text-dsrpt-danger uppercase tracking-wider">
                        Depeg Event Detected
                      </span>
                    </div>
                    <p className="text-xs text-dsrpt-danger/80">
                      Price has fallen below threshold. Policies may be eligible for payout.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-4">
              <CyberButton
                onClick={checkOracle}
                className="flex-1"
                disabled={loading}
              >
                {loading ? 'Checking...' : 'Refresh'}
              </CyberButton>
              <CyberButton
                onClick={onClose}
                className="flex-1"
                disabled={loading}
              >
                Close
              </CyberButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
