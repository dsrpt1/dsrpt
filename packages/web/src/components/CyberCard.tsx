import React from 'react';

interface CyberCardProps {
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
  scan?: boolean;
}

export default function CyberCard({ children, className = '', glow = false, scan = false }: CyberCardProps) {
  return (
    <div className={`cyber-card ${glow ? 'animate-glow' : ''} ${className}`}>
      {scan && <div className="scan-line" />}
      {children}
    </div>
  );
}
