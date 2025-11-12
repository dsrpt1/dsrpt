import React from 'react';

interface CyberButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  className?: string;
}

export default function CyberButton({
  children,
  onClick,
  variant = 'secondary',
  disabled = false,
  className = ''
}: CyberButtonProps) {
  const variantClass = variant === 'primary' ? 'cyber-button-primary' : '';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`cyber-button ${variantClass} ${className} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {children}
    </button>
  );
}
