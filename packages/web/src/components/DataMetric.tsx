import React from 'react';

interface DataMetricProps {
  label: string;
  value: string | number;
  subValue?: string;
  trend?: 'up' | 'down' | 'neutral';
  icon?: React.ReactNode;
}

export default function DataMetric({ label, value, subValue, trend, icon }: DataMetricProps) {
  const trendColor =
    trend === 'up' ? 'text-dsrpt-success' :
    trend === 'down' ? 'text-dsrpt-danger' :
    'text-dsrpt-cyan-secondary';

  const trendSymbol = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '—';

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {icon && <div className="text-dsrpt-cyan-primary">{icon}</div>}
        <div className="text-xs text-dsrpt-cyan-secondary uppercase tracking-wider font-bold">
          {label}
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <div className="text-2xl font-bold text-dsrpt-cyan-primary text-glow font-mono">
          {value}
        </div>
        {trend && (
          <span className={`text-sm font-bold ${trendColor}`}>
            {trendSymbol}
          </span>
        )}
      </div>
      {subValue && (
        <div className="text-xs text-dsrpt-cyan-dark font-mono">
          {subValue}
        </div>
      )}
    </div>
  );
}
