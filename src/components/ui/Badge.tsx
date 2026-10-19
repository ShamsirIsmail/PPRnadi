import React from 'react';

export type BadgeVariant = 'sage' | 'amber' | 'rust' | 'neutral';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}

export function Badge({
  variant = 'neutral',
  children,
  className = '',
  dot = false,
}: BadgeProps) {
  const variantStyles = {
    sage: 'bg-[#EBF3EE] text-[#1E4D33] border border-[#C5DEC9]',
    amber: 'bg-[#FDF3E7] text-[#9E4D0C] border border-[#F3CE9E]',
    rust: 'bg-[#FCECE9] text-[#7E2417] border border-[#F5BDB5]',
    neutral: 'bg-[#EFECE4] text-[#4A473F] border border-[#DDD8CB]',
  }[variant];

  const dotColor = {
    sage: 'bg-[#2A593F]',
    amber: 'bg-[#C86414]',
    rust: 'bg-[#9B3224]',
    neutral: 'bg-[#6A655B]',
  }[variant];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${variantStyles} ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />}
      {children}
    </span>
  );
}
