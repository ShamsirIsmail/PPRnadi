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
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#DDD8CB] hover:bg-[#1F3D2E] hover:text-[#F7F5F0] transition-colors ${className}`}
      >
        <LogOut className="w-3.5 h-3.5" />
        <span>Keluar</span>
      </button>
    </form>
  );
}
