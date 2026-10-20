'use client';

import React, { useActionState, useState, useTransition, Suspense } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, Loader2, Eye, EyeOff } from 'lucide-react';
import { loginAction, demoLoginAction, DemoRole } from '@/app/actions/auth';
import { useTranslation } from '@/lib/i18n/LanguageContext';

function ReturnToInput() {
  const searchParams = useSearchParams();
  const returnTo = searchParams?.get('returnTo');
  if (!returnTo) return null;
  return <input type="hidden" name="returnTo" value={returnTo} />;
}

interface LoginFormProps {
  isDemoEnabled: boolean;
}

export default function LoginForm({ isDemoEnabled }: LoginFormProps) {
  const { t, locale, setLocale } = useTranslation();
  const [state, formAction, isPending] = useActionState(loginAction, null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // 1-Click Demo Login State
  const [isDemoPending, startDemoTransition] = useTransition();
  const [activeDemoRole, setActiveDemoRole] = useState<DemoRole | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [demoErrorCode, setDemoErrorCode] = useState<string | null>(null);

  const handleDemoLogin = (role: DemoRole) => {
    if (isDemoPending || isPending) return;
    setActiveDemoRole(role);
    setDemoError(null);
    setDemoErrorCode(null);

    startDemoTransition(async () => {
      try {
        const result = await demoLoginAction(role);
        if (result?.error) {
          setDemoError(result.error);
          setDemoErrorCode(result.code || null);
          setActiveDemoRole(null);
        }
      } catch (err: unknown) {
        if ((err as Error)?.message?.includes('NEXT_REDIRECT')) {
          throw err;
        }
        setDemoError(
          locale === 'ms'
            ? 'Ralat pelayan semasa log masuk demo. Sila cuba lagi.'
            : 'Server error during demo login. Please try again.'
        );
        setDemoErrorCode('SERVER_ERROR');
        setActiveDemoRole(null);
      }
    });
  };

  const isAnyActionPending = isPending || isDemoPending;

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
            aria-label="Tukar bahasa / Switch language"
          >
            <button
              type="button"
              onClick={() => setLocale('ms')}
              aria-pressed={locale === 'ms'}
              className={`px-3 py-1 text-[13px] font-bold rounded-[20px] transition-all cursor-pointer font-['Manrope',Arial,sans-serif] ${
                locale === 'ms'
                  ? 'bg-[#1956b8] text-white shadow-[0_2px_4px_rgba(25,86,184,0.2)]'
                  : 'text-[#485669] hover:text-[#172332]'
              }`}
            >
              BM
            </button>
            <button
              type="button"
              onClick={() => setLocale('en')}
              aria-pressed={locale === 'en'}
              className={`px-3 py-1 text-[13px] font-bold rounded-[20px] transition-all cursor-pointer font-['Manrope',Arial,sans-serif] ${
                locale === 'en'
                  ? 'bg-[#1956b8] text-white shadow-[0_2px_4px_rgba(25,86,184,0.2)]'
                  : 'text-[#485669] hover:text-[#172332]'
              }`}
            >
              EN
            </button>
          </div>
        </header>

        {/* ================================================================= */}
        {/* HERO SECTION: Middle on mobile, Left Column on Desktop            */}
        {/* ================================================================= */}
        <section
          aria-label="Pengenalan Komuniti PPR NADI"
          className="ppr-hero-col relative overflow-hidden bg-linear-to-b from-[#184ea5] to-[#0c316d] text-white px-5 pt-8 pb-9 sm:px-8 sm:py-9 lg:px-9 lg:py-10 flex flex-col justify-between"
        >
          {/* Subtle background glow */}
          <div
            className="absolute -top-24 -left-24 w-72 h-72 rounded-full bg-[#3b82f6]/20 blur-3xl pointer-events-none"
            aria-hidden="true"
          />

          <div className="relative z-10 space-y-4">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-xs font-semibold tracking-wide text-blue-100">
              <span className="w-2 h-2 rounded-full bg-[#4ade80] animate-pulse" />
              {t.auth.buildingBadge || 'PPR Desa Rejang'}
            </span>

            <h2 className="font-['Playfair_Display',Georgia,serif] text-2xl sm:text-3xl lg:text-3xl xl:text-4xl font-bold leading-tight tracking-tight">
              {t.common.tagline}
            </h2>

            <p className="text-sm sm:text-base text-blue-100/90 leading-relaxed max-w-md font-['Manrope',Arial,sans-serif]">
              {t.auth.welcomeDesc}
            </p>
          </div>

          {/* Value Badges */}
          <div className="relative z-10 pt-6 mt-6 border-t border-white/15 grid grid-cols-2 gap-3 text-xs text-blue-100 font-['Manrope',Arial,sans-serif]">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-300" />
              <span>Aduan kerosakan pantas</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-300" />
              <span>Pantau status pembaikan</span>
            </div>
          </div>
        </section>

        {/* ================================================================= */}
        {/* CONTENT & FORM: Bottom on mobile, Bottom-Right on Desktop         */}
        {/* ================================================================= */}
        <main className="ppr-content-col px-5 py-6 sm:px-8 sm:py-8 lg:px-4 lg:py-2 flex flex-col justify-between">
          <div>
            <h1 className="text-[26px] sm:text-[29px] lg:text-[30px] xl:text-[32px] leading-[1.25] tracking-[-0.8px] font-extrabold text-[#172332] mb-1.5 text-center lg:text-left font-['Manrope',Arial,sans-serif]">
              {t.auth.heading ||
                (locale === 'ms' ? 'Selamat datang.' : 'Welcome back.')}
            </h1>
            <p className="text-[14px] sm:text-[15px] leading-[1.5] text-[#556579] mb-5 text-center lg:text-left font-['Manrope',Arial,sans-serif]">
              {t.auth.intro ||
                (locale === 'ms'
                  ? 'Log masuk untuk mengakses portal anda.'
                  : 'Sign in to access your portal.')}
            </p>

            {/* Server Action Error Alert (Regular Form) */}
            {state?.error && (
              <div
                role="alert"
                className="mb-5 p-3.5 rounded-xl bg-[#fef2f2] border border-[#dc2626] text-sm text-[#991b1b] flex items-start gap-2.5 animate-in fade-in duration-200"
              >
                <AlertCircle className="w-5 h-5 shrink-0 text-[#dc2626] mt-0.5" />
                <span className="font-medium font-['Manrope',Arial,sans-serif]">{state.error}</span>
              </div>
            )}

            {/* Single Unified Standard Login Form */}
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
                  disabled={isAnyActionPending}
                  className="w-full h-[52px] sm:h-[54px] border border-[#e0e6ee] rounded-[13px] px-4 text-[16px] text-[#172332] bg-[#f6f8fb] focus:bg-white focus:outline-none focus:border-[#1956b8] focus:ring-2 focus:ring-[#93baff]/40 transition-all placeholder:text-[#68788c] font-['Manrope',Arial,sans-serif] disabled:opacity-60"
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
                    disabled={isAnyActionPending}
                    className="w-full h-[52px] sm:h-[54px] border border-[#e0e6ee] rounded-[13px] pl-4 pr-12 text-[16px] text-[#172332] bg-[#f6f8fb] focus:bg-white focus:outline-none focus:border-[#1956b8] focus:ring-2 focus:ring-[#93baff]/40 transition-all placeholder:text-[#68788c] font-['Manrope',Arial,sans-serif] disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? t.auth.hidePassword : t.auth.showPassword}
                    aria-controls="login-password"
                    aria-pressed={showPassword}
                    disabled={isAnyActionPending}
                    className="absolute right-1.5 top-1.5 bottom-1.5 w-10 flex items-center justify-center text-[#58677c] hover:text-[#174eaf] rounded-lg transition-colors cursor-pointer disabled:opacity-50"
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
                  disabled={isAnyActionPending}
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

            {/* ============================================================= */}
            {/* 1-Click Demo Login (Server-Flag Gated for Staging/Demo)       */}
            {/* ============================================================= */}
            {isDemoEnabled && (
              <div className="mt-5 pt-4 border-t border-[#e2e8f0]">
                <p className="text-center text-[11px] font-bold text-[#64748b] uppercase tracking-wider mb-2.5 font-['Manrope',Arial,sans-serif]">
                  {t.auth.demoSharedNotice ||
                    (locale === 'ms'
                      ? 'Akaun demo dikongsi — untuk ujian sahaja'
                      : 'Shared demo account — for testing only')}
                </p>

                {/* Demo Action Error Alert */}
                {demoError && (
                  <div
                    role="alert"
                    id="demo-error-alert"
                    data-testid="demo-error-alert"
                    data-error-code={demoErrorCode || undefined}
                    className="mb-3 p-3 rounded-xl bg-[#fef2f2] border border-[#dc2626] text-xs text-[#991b1b] flex items-start gap-2 animate-in fade-in duration-200"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 text-[#dc2626] mt-0.5" />
                    <span className="font-medium font-['Manrope',Arial,sans-serif]">{demoError}</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    id="demo-resident-btn"
                    data-testid="demo-resident-btn"
                    disabled={isAnyActionPending}
                    onClick={() => handleDemoLogin('resident')}
                    className="min-h-[44px] py-2.5 px-3 rounded-xl border border-[#b6d2fe] bg-[#edf4ff] hover:bg-[#dce9fd] text-xs font-bold text-[#1554ad] transition-colors cursor-pointer text-center font-['Manrope',Arial,sans-serif] flex items-center justify-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {activeDemoRole === 'resident' && isDemoPending ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                        <span>{t.auth.demoSigningIn || 'Sedang log masuk...'}</span>
                      </>
                    ) : (
                      <span>{t.auth.demoResidentBtnText || (locale === 'ms' ? 'Penduduk' : 'Resident')}</span>
                    )}
                  </button>

                  <button
                    type="button"
                    id="demo-manager-btn"
                    data-testid="demo-manager-btn"
                    disabled={isAnyActionPending}
                    onClick={() => handleDemoLogin('management')}
                    className="min-h-[44px] py-2.5 px-3 rounded-xl border border-[#b6d2fe] bg-[#edf4ff] hover:bg-[#dce9fd] text-xs font-bold text-[#1554ad] transition-colors cursor-pointer text-center font-['Manrope',Arial,sans-serif] flex items-center justify-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {activeDemoRole === 'management' && isDemoPending ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                        <span>{t.auth.demoSigningIn || 'Sedang log masuk...'}</span>
                      </>
                    ) : (
                      <span>{t.auth.demoManagerBtnText || (locale === 'ms' ? 'Pengurusan' : 'Management')}</span>
                    )}
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
