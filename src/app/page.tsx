'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { 
  Building2, 
  Activity, 
  ShieldCheck, 
  Users, 
  FileCheck,
  Radio,
  ArrowRight,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n/LanguageContext';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';

export default function HomePage() {
  const { t, locale } = useTranslation();

  return (
    <div className="min-h-screen bg-white text-[#17212F] flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-200 bg-white/95 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative w-10 h-10 rounded-xl overflow-hidden shadow-xs border border-slate-200 bg-white flex items-center justify-center shrink-0">
              <Image
                src="/images/logo.png"
                alt="PPR NADI Emblem"
                width={36}
                height={36}
                className="object-contain"
                priority
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-xl tracking-tight text-[#1554AD]">
                  PPR NADI
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#F0F5FC] text-[#1554AD] font-bold border border-[#CBD5E1]">
                  PPR SENTOSA
                </span>
              </div>
              <p className="text-xs text-slate-500 hidden sm:block">
                {locale === 'ms'
                  ? 'Sistem Ketahanan Komuniti & Pengurusan Fasiliti'
                  : 'Public Housing Community & Facility Resilience'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Link
              href="/login"
              className="text-xs sm:text-sm font-bold px-4 py-2 rounded-xl bg-[#1554AD] text-white hover:bg-[#0D3E82] transition-all shadow-xs"
            >
              {t.auth.signInBtn}
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-16 w-full">
        {/* Synthetic Demo Banner */}
        <div className="mb-6 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#F0F5FC] border border-[#CBD5E1] text-[#1554AD] text-xs font-semibold">
          <Radio className="w-3.5 h-3.5 text-[#1554AD] animate-pulse" />
          <span>
            {locale === 'ms' ? 'Kawasan Demonstrasi:' : 'Demonstration Estate:'}{' '}
            <strong className="text-[#17212F]">PPR Sentosa</strong> (Blok A, B &amp; C)
          </span>
        </div>

        <div className="max-w-3xl mb-12 sm:mb-16">
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-[#17212F] leading-[1.15]">
            {locale === 'ms'
              ? 'Ketahanan Infrastruktur & Kesinambungan Komuniti PPR.'
              : 'Public Housing Facility Resilience & Community Continuity.'}
          </h1>
          <p className="mt-4 sm:mt-6 text-base sm:text-lg text-slate-600 leading-relaxed font-medium">
            {locale === 'ms'
              ? 'Platform telus dan mudah capai untuk pelaporan kerosakan fasiliti, semakan bukti bergambar berpusat, dan penyebaran notis rasmi pengurusan kepada seluruh penduduk.'
              : 'A clean, accessible community platform for reporting maintenance issues, verifying physical photo evidence, and communicating verified official restoration notices.'}
          </p>
        </div>

        {/* Dual Portal Gateway */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
          {/* Resident Portal Gateway */}
          <div className="rounded-3xl border-2 border-slate-200 bg-white p-7 sm:p-9 flex flex-col justify-between shadow-xs hover:border-[#1554AD] transition-all group">
            <div>
              <div className="w-14 h-14 rounded-2xl bg-[#F0F5FC] text-[#1554AD] flex items-center justify-center mb-6 border border-[#CBD5E1]">
                <Users className="w-7 h-7" />
              </div>
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#1554AD]">
                {locale === 'ms' ? 'Mudah Alih • Warga Emas Mesra' : 'Mobile First • Senior Friendly'}
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-[#17212F] mt-1.5 mb-3">
                {t.nav.portalResident}
              </h2>
              <p className="text-sm sm:text-base text-slate-600 leading-relaxed mb-6 font-medium">
                {locale === 'ms'
                  ? 'Semak notis gangguan lif, air dan lampu mengikut blok kediaman anda. Hantar aduan dengan mudah berserta bukti gambar kamera tanpa borang rumit.'
                  : 'Check elevator, water and lighting service notices for your building. Submit maintenance reports with photos directly from your camera in 1 minute.'}
              </p>

              <div className="space-y-2.5 mb-8 text-xs sm:text-sm text-slate-700 font-medium">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#1554AD]" />
                  <span>
                    {locale === 'ms'
                      ? 'Notis rasmi menjawab 5 soalan penting gangguan'
                      : 'Official notices answering the 5 critical questions'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#1554AD]" />
                  <span>
                    {locale === 'ms'
                      ? 'Privasi dijamin — tiada pengumpulan dokumen peribadi'
                      : 'Privacy assured — no personal identity documents collected'}
                  </span>
                </div>
              </div>
            </div>

            <Link
              href="/resident"
              className="w-full inline-flex items-center justify-between px-6 py-4 rounded-2xl bg-[#1554AD] text-white font-bold text-sm sm:text-base hover:bg-[#0D3E82] transition-all shadow-xs group"
            >
              <span>{locale === 'ms' ? 'Buka Portal Penduduk' : 'Open Resident Portal'}</span>
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>

          {/* Management Portal Gateway */}
          <div className="rounded-3xl border-2 border-slate-200 bg-white p-7 sm:p-9 flex flex-col justify-between shadow-xs hover:border-[#1554AD] transition-all group">
            <div>
              <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-800 flex items-center justify-center mb-6 border border-slate-200">
                <Building2 className="w-7 h-7" />
              </div>
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-600">
                {locale === 'ms' ? 'Pusat Kawalan • Desktop' : 'Control Center • Desktop'}
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-[#17212F] mt-1.5 mb-3">
                {t.nav.portalManagement}
              </h2>
              <p className="text-sm sm:text-base text-slate-600 leading-relaxed mb-6 font-medium">
                {locale === 'ms'
                  ? 'Peti semakan aduan penduduk, semakan gambar bukti kerosakan, pendaftaran insiden fasiliti, dan penyiaran buletin rasmi kepada seluruh komuniti.'
                  : 'Review incoming reports, inspect photo evidence, register and verify facility incidents, and publish official notices directly to residents.'}
              </p>

              <div className="space-y-2.5 mb-8 text-xs sm:text-sm text-slate-700 font-medium">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#1554AD]" />
                  <span>
                    {locale === 'ms'
                      ? 'Pengesahan manusia mutlak bagi setiap tindakan siasatan'
                      : 'Complete human oversight for every investigation milestone'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#1554AD]" />
                  <span>
                    {locale === 'ms'
                      ? 'Penyatuan pelbagai aduan ke punca fizikal yang sama'
                      : 'Consolidation of multiple resident reports to a single incident'}
                  </span>
                </div>
              </div>
            </div>

            <Link
              href="/management"
              className="w-full inline-flex items-center justify-between px-6 py-4 rounded-2xl bg-[#17212F] text-white font-bold text-sm sm:text-base hover:bg-slate-800 transition-all shadow-xs group"
            >
              <span>{locale === 'ms' ? 'Buka Pusat Pengurusan' : 'Open Management Portal'}</span>
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>

        {/* Teras Inovasi */}
        <div className="border-t border-slate-200 pt-12">
          <h3 className="text-xs uppercase font-mono font-bold tracking-wider text-slate-500 mb-6">
            {locale === 'ms' ? 'Prinsip Rekabentuk PPR NADI' : 'PPR NADI Design Principles'}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-2xl bg-[#F8FAFC] border border-slate-200">
              <div className="w-10 h-10 rounded-xl bg-[#1554AD] text-white flex items-center justify-center mb-4">
                <Activity className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-[#17212F] text-base mb-1.5">
                {locale === 'ms' ? 'Mudah & Boleh Akses' : 'Clean & Accessible'}
              </h4>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                {locale === 'ms'
                  ? 'Tipografi bersaiz selesa (~18px), butang sentuh minimum 48px, dan kontras tinggi untuk kegunaan warga emas dan semua lapisan penduduk.'
                  : 'Comfortable typography (~18px body), $\ge$48px touch targets, and high contrast for seniors and all residents.'}
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-[#F8FAFC] border border-slate-200">
              <div className="w-10 h-10 rounded-xl bg-[#1554AD] text-white flex items-center justify-center mb-4">
                <FileCheck className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-[#17212F] text-base mb-1.5">
                {locale === 'ms' ? 'Dwibahasa Penuh' : 'Complete Bilingual'}
              </h4>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                {locale === 'ms'
                  ? 'Sokongan Bahasa Melayu dan Bahasa Inggeris yang konsisten merentas portal penduduk dan pengurusan tanpa ralat status teknikal mentah.'
                  : 'Seamless Bahasa Melayu and English across resident and management portals without raw technical error codes.'}
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-[#F8FAFC] border border-slate-200">
              <div className="w-10 h-10 rounded-xl bg-[#1554AD] text-white flex items-center justify-center mb-4">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-[#17212F] text-base mb-1.5">
                {locale === 'ms' ? 'Keselamatan RLS & Audit' : 'RLS Security & Audit'}
              </h4>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                {locale === 'ms'
                  ? 'Kawalan akses berasaskan peranan PostgreSQL RLS yang ketat dengan jejak audit mutlak bagi setiap pengubahsuaian data.'
                  : 'Strict PostgreSQL RLS role-based access control with complete audit trails for every database mutation.'}
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-[#F8FAFC] py-8 text-center text-xs text-slate-500">
        <p className="font-medium">
          PPR NADI • {locale === 'ms' ? 'Sistem Ketahanan Komuniti Perumahan Awam Malaysia' : 'Malaysian Public Housing Community Resilience Platform'} • 2026
        </p>
      </footer>
    </div>
  );
}
