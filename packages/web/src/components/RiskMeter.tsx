import React from 'react';

interface RiskMeterProps {
  value: number; // 0-100
  label?: string;
  showValue?: boolean;
}

export default function RiskMeter({ value, label, showValue = true }: RiskMeterProps) {
  const clampedValue = Math.max(0, Math.min(100, value));

  const getColor = (val: number) => {
    if (val < 30) return '#00ff66'; // green
    if (val < 70) return '#ffaa00'; // yellow
    return '#ff0066'; // red
  };

  return (
    <div className="space-y-2">
      {label && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-dsrpt-cyan-secondary uppercase tracking-wider font-bold">{label}</span>
          {showValue && (
            <span className="text-dsrpt-cyan-primary font-mono">{clampedValue}%</span>
          )}
        </div>
      )}
      <div className="risk-meter">
        <div
          className="risk-meter-fill"
          style={{
            width: `${clampedValue}%`,
            background: getColor(clampedValue),
            boxShadow: `0 0 10px ${getColor(clampedValue)}80`
          }}
        />
      </div>
    </div>
  );
}
