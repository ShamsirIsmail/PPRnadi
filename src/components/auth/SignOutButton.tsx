'use client';

import React from 'react';
import { LogOut } from 'lucide-react';
import { logoutAction } from '@/app/actions/auth';

export function SignOutButton({ className = '' }: { className?: string }) {
  return (
    <form action={logoutAction} className="inline">
      <button
        type="submit"
        aria-label="Log keluar akaun"
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-700 hover:bg-red-50 hover:text-red-700 transition-colors cursor-pointer min-h-[38px] ${className}`}
      >
        <LogOut className="w-3.5 h-3.5" />
        <span>Keluar</span>
      </button>
    </form>
  );
}
