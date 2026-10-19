import React, { Suspense } from 'react';
import { ManagementHeader } from '@/components/management/ManagementHeader';

export const instant = false;

export default function ManagementLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white text-[#17212F] flex flex-col">
      <ManagementHeader />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        <Suspense fallback={<div className="animate-pulse p-4 text-sm text-[#374151]">Memuatkan...</div>}>
          {children}
        </Suspense>
      </main>
      <footer className="border-t border-[#CBD5E1] bg-[#F8F9FA] py-4 px-6 text-xs text-[#374151] flex flex-col sm:flex-row items-center justify-between gap-2">
        <p>PPR NADI • Pusat Operasi Pengurusan PPR Sentosa</p>
        <p className="font-mono text-[11px] text-[#1554AD] font-bold">
          Sistem Pengesahan Manusia Mandatori (Human-in-the-Loop)
        </p>
      </footer>
    </div>
  );
}
