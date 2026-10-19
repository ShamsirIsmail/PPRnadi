import React, { Suspense } from 'react';
import { ResidentHeader } from '@/components/resident/ResidentHeader';
import { ResidentBottomNav } from '@/components/resident/ResidentBottomNav';

export const instant = false;

export default function ResidentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white text-[#17212F] flex flex-col">
      <ResidentHeader />
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6 pb-24 md:pb-8">
        <Suspense fallback={<div className="animate-pulse p-4 text-sm text-[#374151]">Memuatkan...</div>}>
          {children}
        </Suspense>
      </main>
      <ResidentBottomNav />
      <footer className="hidden md:block border-t border-[#CBD5E1] bg-[#F8F9FA] py-4 text-center text-xs text-[#374151]">
        PPR NADI • Portal Penduduk PPR Sentosa
      </footer>
    </div>
  );
}
