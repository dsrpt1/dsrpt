import React from 'react';

type BadgeStatus = 'ok' | 'warn' | 'error';

interface StatusBadgeProps {
  status: BadgeStatus;
  label?: string;
}

export default function StatusBadge({ status, label }: StatusBadgeProps) {
  const statusClass =
    status === 'ok' ? 'status-active' :
    status === 'warn' ? 'status-pending' :
    'status-inactive';

  const displayLabel =
    label ||
    (status === 'ok' ? 'ONLINE' :
     status === 'warn' ? 'CHECK' :
     'OFFLINE');

  const pulseClass = status === 'ok' ? 'animate-pulse-slow' : '';

  return (
    <span className={`status-indicator ${statusClass}`}>
      <span className={`w-2 h-2 rounded-full ${pulseClass}`}
            style={{
              backgroundColor: status === 'ok' ? '#00ff66' :
                              status === 'warn' ? '#ffaa00' :
                              '#ff0066'
            }}
      />
      {displayLabel}
    </span>
  );
}
