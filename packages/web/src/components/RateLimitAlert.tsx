import React from 'react';

interface RateLimitAlertProps {
  show: boolean;
  onClose?: () => void;
}

export default function RateLimitAlert({ show, onClose }: RateLimitAlertProps) {
  if (!show) return null;

  return (
    <div className="fixed top-20 right-6 z-50 max-w-md">
      <div className="cyber-card bg-dsrpt-gray-900 border-dsrpt-warning/50 shadow-xl">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0">
            <div className="w-10 h-10 rounded-full bg-dsrpt-warning/20 border border-dsrpt-warning flex items-center justify-center">
              <span className="text-dsrpt-warning text-xl">⚠</span>
            </div>
          </div>

          <div className="flex-1">
            <h3 className="text-sm font-bold text-dsrpt-warning uppercase tracking-wider mb-2">
              RPC Rate Limit Detected
            </h3>
            <p className="text-xs text-dsrpt-cyan-secondary mb-3 leading-relaxed">
              The public RPC endpoint is experiencing rate limits. Some data may load slowly or fail.
            </p>

            <div className="bg-dsrpt-gray-800 border border-dsrpt-cyan-primary/20 rounded p-3 mb-3">
              <p className="text-xs text-dsrpt-cyan-dark font-mono mb-2">
                &gt; RECOMMENDATION:
              </p>
              <p className="text-xs text-dsrpt-cyan-secondary">
                Configure a dedicated RPC endpoint in <code className="text-dsrpt-cyan-primary">.env</code> for better performance:
              </p>
              <ul className="mt-2 space-y-1 text-xs text-dsrpt-cyan-dark">
                <li>• Alchemy (recommended)</li>
                <li>• QuickNode</li>
                <li>• Coinbase Cloud</li>
              </ul>
            </div>

            {onClose && (
              <button
                onClick={onClose}
                className="text-xs text-dsrpt-cyan-primary hover:text-dsrpt-cyan-secondary uppercase tracking-wider font-bold transition-colors"
              >
                Dismiss
              </button>
            )}
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="flex-shrink-0 text-dsrpt-cyan-dark hover:text-dsrpt-cyan-primary transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Animated border */}
        <div className="absolute bottom-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-dsrpt-warning to-transparent animate-pulse" />
      </div>
    </div>
  );
}
