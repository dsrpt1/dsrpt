import React from 'react';

interface CyberButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
}

export default function CyberButton({
  children,
  onClick,
  variant = 'secondary',
  disabled = false,
  className = '',
  type = 'submit'
}: CyberButtonProps) {
  const variantClass = variant === 'primary' ? 'cyber-button-primary' : '';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`cyber-button ${variantClass} ${className} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {children}
    </button>
  );
}
