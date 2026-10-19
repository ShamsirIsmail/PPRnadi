import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonProps) {
  const baseStyles = 'inline-flex items-center justify-center font-medium rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none cursor-pointer';

  const sizeStyles = {
    sm: 'px-2.5 py-1.5 text-xs gap-1.5',
    md: 'px-4 py-2 text-sm gap-2',
    lg: 'px-5 py-2.5 text-base gap-2.5',
  }[size];

  const variantStyles = {
    primary: 'bg-[#162E22] text-[#F7F5F0] hover:bg-[#1F3D2E] focus:ring-[#162E22] shadow-sm',
    secondary: 'bg-[#EFECE4] text-[#162E22] border border-[#DDD8CB] hover:bg-[#DDD8CB] focus:ring-[#162E22]',
    outline: 'bg-transparent text-[#162E22] border border-[#162E22] hover:bg-[#162E22]/10 focus:ring-[#162E22]',
    danger: 'bg-[#9B3224] text-white hover:bg-[#7D281C] focus:ring-[#9B3224] shadow-sm',
  }[variant];

  return (
    <button
      className={`${baseStyles} ${sizeStyles} ${variantStyles} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
