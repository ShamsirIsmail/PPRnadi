'use client';

import React, { useActionState, useState, Suspense } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, Loader2, Eye, EyeOff } from 'lucide-react';
import { loginAction } from '@/app/actions/auth';
import { useTranslation } from '@/lib/i18n/LanguageContext';

function ReturnToInput() {
  const searchParams = useSearchParams();
  const returnTo = searchParams?.get('returnTo');
  if (!returnTo) return null;
  return <input type="hidden" name="returnTo" value={returnTo} />;
}

export default function LoginPage() {
  const { t, locale, setLocale } = useTranslation();
  const [state, formAction, isPending] = useActionState(loginAction, null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);


  const isLocalEnv =
    process.env.NODE_ENV === 'development' ||
    process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO === 'true';

  const fillDemoEmail = (demoEmail: string) => {
    setEmail(demoEmail);
  };

  return (
    <>
      {/* External font stylesheet for Manrope & Playfair Display */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,700;1,500&display=swap"
      />
      <style>{`
        .ppr-login-shell {
          display: flex;
          flex-direction: column;
        }
        .ppr-header-col {
          order: 1;
        }
        .ppr-hero-col {
          order: 2;
        }
        .ppr-content-col {
          order: 3;
        }
        @media (min-width: 1024px) {
          .ppr-login-shell {
            display: grid !important;
            grid-template-columns: 1.18fr 1fr;
            grid-template-rows: auto 1fr;
            grid-template-areas:
              "hero header"
              "hero content";
          }
          .ppr-hero-col {
            grid-area: hero;
            height: 100% !important;
            min-height: 540px;
            border-radius: 22px;
          }
          .ppr-header-col {
            grid-area: header;
          }
          .ppr-content-col {
            grid-area: content;
            margin-top: 0 !important;
            border-radius: 0 !important;
            padding-top: 0 !important;
            padding-left: 1.25rem !important;
            padding-right: 1.25rem !important;
          }
        }
      `}</style>

      {/* Main Card Shell: 430px on mobile, max 1160px/1200px 2-column on desktop */}
      <div className="ppr-login-shell w-full max-w-[430px] lg:max-w-[1140px] xl:max-w-[1200px] mx-auto bg-white sm:rounded-[28px] sm:border sm:border-[#dce3ec] lg:border-[#e2e8f0] overflow-hidden sm:shadow-[0_16px_48px_rgba(20,44,72,0.08)] lg:shadow-[0_12px_44px_rgba(20,44,72,0.05)] lg:p-6 xl:p-7 lg:gap-x-8 xl:gap-x-12 lg:items-stretch">
        
        {/* ================================================================= */}
        {/* HEADER: Top on mobile, Top-Right on Desktop                      */}
        {/* ================================================================= */}
        <header className="ppr-header-col px-5 py-4 sm:px-[22px] sm:py-[19px] lg:px-4 lg:py-1 flex items-center justify-between gap-3 bg-white lg:bg-transparent lg:mb-4">
          <div className="flex items-center gap-2.5 whitespace-nowrap">
            <Image
              src="/images/nadi-emblem.png"
              alt="Logo PPR NADI"
              width={49}
              height={49}
              priority
              className="w-10 h-10 sm:w-[46px] sm:h-[46px] lg:w-[48px] lg:h-[48px] object-contain block shrink-0"
            />
            <span
              className="font-['Playfair_Display',Georgia,serif] text-[26px] sm:text-[29px] lg:text-[30px] leading-none inline-flex items-baseline select-none"
              aria-label="PPR Nadi"
            >
              <b className="text-[#0b4699] font-bold tracking-[1px]">PPR</b>
              <em className="text-[#ed2431] font-medium text-[28px] sm:text-[31px] lg:text-[32px] tracking-[-0.9px] not-italic italic">
                nadi
              </em>
            </span>
          </div>

          {/* Language Switcher Capsule */}
          <div
            className="flex border border-[#e5eaf1] rounded-[24px] p-[3px] gap-[1px] bg-[#f3f6fa] shrink-0"
            role="group"
            aria-label={locale === 'ms' ? 'Pilihan Bahasa' : 'Language Selection'}
          >
            <button
              type="button"
              onClick={() => setLocale('ms')}
              aria-label="Bahasa Melayu"
              aria-pressed={locale === 'ms'}
              className={`border-0 rounded-[20px] min-w-[44px] min-h-[38px] sm:min-h-[40px] px-2.5 sm:px-[11px] text-[13px] font-bold transition-all cursor-pointer font-['Manrope',Arial,sans-serif] ${
                locale === 'ms'
                  ? 'bg-white text-[#174eaf] shadow-[0_1px_4px_rgba(23,51,88,0.12)]'
                  : 'bg-transparent text-[#536175] hover:text-[#174eaf]'
              }`}
            >
              BM
            </button>
            <button
              type="button"
              onClick={() => setLocale('en')}
              aria-label="English"
              aria-pressed={locale === 'en'}
              className={`border-0 rounded-[20px] min-w-[44px] min-h-[38px] sm:min-h-[40px] px-2.5 sm:px-[11px] text-[13px] font-bold transition-all cursor-pointer font-['Manrope',Arial,sans-serif] ${
                locale === 'en'
                  ? 'bg-white text-[#174eaf] shadow-[0_1px_4px_rgba(23,51,88,0.12)]'
                  : 'bg-transparent text-[#536175] hover:text-[#174eaf]'
              }`}
            >
              English
            </button>
          </div>
        </header>

        {/* ================================================================= */}
        {/* HERO: Middle on Mobile, Left Column (~55%) on Desktop            */}
        {/* ================================================================= */}
        <div className="ppr-hero-col relative h-[210px] sm:h-[245px] bg-[#193e6b] overflow-hidden lg:rounded-[22px]">
          <Image
            src="/images/ppr-login-building.jpg"
            alt={
              locale === 'ms'
                ? 'Gambar bangunan PPR Desa Rejang untuk PPR NADI'
                : 'PPR Desa Rejang residential building photograph for PPR NADI'
            }
            fill
            priority
            sizes="(max-width: 1023px) 100vw, 55vw"
            className="object-cover object-[52%_45%]"
          />

          {/* Mobile Overlay Shade with Pill Badge */}
          <div className="lg:hidden absolute inset-0 bg-gradient-to-b from-transparent via-[rgba(16,46,73,0.40)] to-[rgba(11,40,73,0.78)] flex flex-col items-center justify-end pb-[42px] px-6 text-center">
            <span className="inline-block bg-[rgba(11,35,65,0.65)] backdrop-blur-[3px] text-white text-[13px] sm:text-[14px] font-semibold tracking-[0.2px] px-3.5 py-1 rounded-full border border-white/25 shadow-sm font-['Manrope',Arial,sans-serif]">
              {t.auth.buildingBadge || 'PPR Desa Rejang'}
            </span>
          </div>

          {/* Desktop Overlay: Crisp Dark Gradient with Official Building Name & Tagline */}
          <div className="hidden lg:flex flex-col justify-end absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-7 xl:p-8">
            <h2 className="text-white text-[24px] xl:text-[27px] font-bold tracking-[0.2px] font-['Manrope',Arial,sans-serif] leading-tight drop-shadow-sm">
              PPR Desa Rejang
            </h2>
            <p className="text-white/95 text-[14px] xl:text-[15px] font-medium tracking-[0.15px] mt-1.5 font-['Manrope',Arial,sans-serif] drop-shadow-sm">
              {t.common.tagline}
            </p>
          </div>
        </div>

        {/* ================================================================= */}
        {/* CONTENT & FORM: Bottom on Mobile, Right Column (~45%) on Desktop   */}
        {/* ================================================================= */}
        <main
          className="ppr-content-col relative -mt-[29px] bg-white px-6 sm:px-7 pt-7 pb-6 z-10 lg:flex lg:flex-col lg:justify-between"
          style={{ borderRadius: '50% 50% 0 0 / 30px 30px 0 0' }}
        >
          <div className="max-w-[420px] w-full mx-auto lg:mx-0">
            {/* Heading & Subtitle */}
            <h1 className="text-[26px] sm:text-[29px] lg:text-[30px] xl:text-[32px] leading-[1.25] tracking-[-0.8px] font-extrabold text-[#172332] mb-1.5 text-center lg:text-left font-['Manrope',Arial,sans-serif]">
              {t.auth.heading || (locale === 'ms' ? 'Selamat datang.' : 'Welcome back.')}
            </h1>
            <p className="text-[15px] sm:text-[16px] leading-[1.5] text-[#536174] mb-5 xl:mb-6 text-center lg:text-left font-['Manrope',Arial,sans-serif]">
              {t.auth.intro ||
                (locale === 'ms'
                  ? 'Log masuk untuk mengakses portal anda.'
                  : 'Sign in to access your portal.')}
            </p>

            {/* Server Action Error Alert */}
            {state?.error && (
              <div
                role="alert"
                className="mb-5 p-3.5 rounded-xl bg-[#fef2f2] border border-[#dc2626] text-sm text-[#991b1b] flex items-start gap-2.5 animate-in fade-in duration-200"
              >
                <AlertCircle className="w-5 h-5 shrink-0 text-[#dc2626] mt-0.5" />
                <span className="font-medium font-['Manrope',Arial,sans-serif]">{state.error}</span>
              </div>
            )}

            {/* Single Unified Form */}
            <form action={formAction} className="space-y-4">
              {/* Safe returnTo parameter in isolated Suspense boundary */}
              <Suspense fallback={null}>
                <ReturnToInput />
              </Suspense>

              {/* Email Field */}
              <div>
                <label
                  htmlFor="login-email"
                  className="block text-[14px] sm:text-[15px] font-semibold text-[#233247] mb-1.5 font-['Manrope',Arial,sans-serif]"
                >
                  {t.auth.emailLabel}
                </label>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.auth.emailPlaceholder}
                  disabled={isPending}
                  className="w-full h-[52px] sm:h-[54px] border border-[#e0e6ee] rounded-[13px] px-4 text-[16px] text-[#172332] bg-[#f6f8fb] focus:bg-white focus:outline-none focus:border-[#1956b8] focus:ring-2 focus:ring-[#93baff]/40 transition-all placeholder:text-[#68788c] font-['Manrope',Arial,sans-serif]"
                />
              </div>

              {/* Password Field with Show/Hide Toggle */}
              <div>
                <label
                  htmlFor="login-password"
                  className="block text-[14px] sm:text-[15px] font-semibold text-[#233247] mb-1.5 font-['Manrope',Arial,sans-serif]"
                >
                  {t.auth.passwordLabel}
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t.auth.passwordPlaceholder}
                    disabled={isPending}
                    className="w-full h-[52px] sm:h-[54px] border border-[#e0e6ee] rounded-[13px] pl-4 pr-12 text-[16px] text-[#172332] bg-[#f6f8fb] focus:bg-white focus:outline-none focus:border-[#1956b8] focus:ring-2 focus:ring-[#93baff]/40 transition-all placeholder:text-[#68788c] font-['Manrope',Arial,sans-serif]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? t.auth.hidePassword : t.auth.showPassword}
                    aria-controls="login-password"
                    aria-pressed={showPassword}
                    className="absolute right-1.5 top-1.5 bottom-1.5 w-10 flex items-center justify-center text-[#58677c] hover:text-[#174eaf] rounded-lg transition-colors cursor-pointer"
                  >
                    {showPassword ? (
                      <EyeOff className="w-5 h-5 stroke-[1.8]" />
                    ) : (
                      <Eye className="w-5 h-5 stroke-[1.8]" />
                    )}
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <div className="pt-2">
                <button
                  id="login-submit-btn"
                  type="submit"
                  disabled={isPending}
                  className="w-full h-[52px] sm:h-[54px] flex items-center justify-center gap-2 border border-[#164ca8] rounded-[16px] bg-[#1956b8] hover:bg-[#12479e] active:translate-y-[1px] text-white text-[16px] sm:text-[17px] font-bold tracking-[0.1px] shadow-[0_4px_10px_rgba(25,86,184,0.18)] transition-all disabled:opacity-60 cursor-pointer font-['Manrope',Arial,sans-serif]"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>{t.auth.signingIn}</span>
                    </>
                  ) : (
                    <span>{t.auth.signInBtn}</span>
                  )}
                </button>
              </div>
            </form>

            {/* Account Help Note */}
            <p className="text-[14px] sm:text-[15px] leading-[1.55] text-[#536174] text-center mt-5 font-['Manrope',Arial,sans-serif]">
              <strong className="text-[#273951] font-semibold block">{t.auth.noAccount}</strong>
              <span>{t.auth.contactManagement}</span>
            </p>

            {/* Local Demo Shortcuts (Development / Demo Environment Only) */}
            {isLocalEnv && (
              <div className="mt-4 pt-3.5 border-t border-[#e2e8f0]">
                <p className="text-center text-[11px] font-bold text-[#64748b] uppercase tracking-wider mb-2">
                  {locale === 'ms' ? 'Akaun Ujian Demo (Desa Rejang & Sentosa)' : 'Quick Demo Accounts (Desa Rejang & Sentosa)'}
                </p>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => fillDemoEmail('resident.rejang@nadi.local')}
                    className="py-2 px-2.5 rounded-xl border border-[#b6d2fe] bg-[#edf4ff] hover:bg-[#dce9fd] text-xs font-bold text-[#1554ad] transition-colors cursor-pointer text-center font-['Manrope',Arial,sans-serif]"
                  >
                    {locale === 'ms' ? 'Penduduk Desa Rejang (Blok A T17)' : 'Resident Desa Rejang (Blk A F17)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => fillDemoEmail('manager.rejang@nadi.local')}
                    className="py-2 px-2.5 rounded-xl border border-[#b6d2fe] bg-[#edf4ff] hover:bg-[#dce9fd] text-xs font-bold text-[#1554ad] transition-colors cursor-pointer text-center font-['Manrope',Arial,sans-serif]"
                  >
                    {locale === 'ms' ? 'Pengurus Desa Rejang' : 'Manager Desa Rejang'}
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => fillDemoEmail('resident@sentosa.local')}
                    className="flex-1 py-1.5 px-2 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] hover:bg-[#f1f5f9] text-[11px] font-medium text-[#64748b] transition-colors cursor-pointer text-center font-['Manrope',Arial,sans-serif]"
                  >
                    {locale === 'ms' ? 'Penduduk Sentosa' : 'Resident Sentosa'}
                  </button>
                  <button
                    type="button"
                    onClick={() => fillDemoEmail('manager@sentosa.local')}
                    className="flex-1 py-1.5 px-2 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] hover:bg-[#f1f5f9] text-[11px] font-medium text-[#64748b] transition-colors cursor-pointer text-center font-['Manrope',Arial,sans-serif]"
                  >
                    {locale === 'ms' ? 'Pengurus Sentosa' : 'Manager Sentosa'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Desktop Footer Info */}
          <footer className="hidden lg:block text-center mt-4 pt-2">
            <span className="text-[12px] text-[#8594a6] tracking-[0.15px] font-['Manrope',Arial,sans-serif]">
              {t.auth.communityFooter ||
                (locale === 'ms'
                  ? 'Untuk penduduk dan pengurusan komuniti.'
                  : 'For residents and community management.')}
            </span>
          </footer>

          {/* Mobile Footer with Tagline & Purpose */}
          <footer className="lg:hidden px-2 pb-2 pt-4 text-center bg-white border-t border-transparent">
            <div className="text-[13px] font-semibold text-[#174eaf] tracking-wide mb-1 font-['Manrope',Arial,sans-serif]">
              {t.common.tagline}
            </div>
            <span className="text-[12px] text-[#5a6b80] tracking-[0.15px] font-['Manrope',Arial,sans-serif]">
              {t.auth.communityFooter ||
                (locale === 'ms'
                  ? 'Untuk penduduk dan pengurusan komuniti.'
                  : 'For residents and community management.')}
            </span>
          </footer>
        </main>
      </div>
    </>
  );
}
