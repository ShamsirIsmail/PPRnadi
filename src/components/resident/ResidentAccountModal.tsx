'use client';

import React, { useState, useEffect } from 'react';
import { X, Building2, User, Phone, ShieldCheck, LogOut, Loader2 } from 'lucide-react';
import { logoutAction } from '@/app/actions/auth';
import { useTranslation } from '@/lib/i18n/LanguageContext';
import type { ProfileRow } from '@/types/database';

import { resolveEstateName } from '@/lib/estate/estate-resolver';

interface ResidentAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: ProfileRow | null;
  building?: { name: string; code?: string; estate_id?: string } | null;
}

export function ResidentAccountModal({
  isOpen,
  onClose,
  profile,
  building,
}: ResidentAccountModalProps) {
  const { t, locale } = useTranslation();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Close modal on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmLogout) {
          setConfirmLogout(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, confirmLogout, onClose]);

  if (!isOpen) return null;

  const rawName = profile?.full_name || 'Penduduk';
  const displayName = rawName.replace(/\s*\(.*?\)\s*/, '');
  const initial = displayName.charAt(0).toUpperCase() || 'P';

  const estateResolution = resolveEstateName(
    profile?.assigned_estate_id || building?.estate_id,
    locale
  );
  const estateName = estateResolution.name;

  const buildingName = building?.name || t.residentHome.unspecifiedBuilding;
  const unitText = profile?.unit_number ? `Unit ${profile.unit_number}` : t.residentHome.notRegistered;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px] animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-modal-title"
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-[#cbd5e1] overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e2e8f0] bg-[#f8faff]">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-[#1956b8]" />
            <h2 id="account-modal-title" className="text-base sm:text-lg font-bold text-[#17212f]">
              {t.residentHome.accountModalTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.residentHome.closeModal}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-[#64748b] hover:text-[#17212f] hover:bg-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 space-y-5">
          {/* Resident Identity Row */}
          <div className="flex items-center gap-3.5 pb-4 border-b border-[#e2e8f0]">
            <div className="w-13 h-13 rounded-xl bg-[#edf3fc] text-[#1956b8] flex items-center justify-center font-bold text-xl shrink-0">
              {initial}
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-[#17212f] leading-snug">
                {profile?.full_name || 'Penduduk'}
              </h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#eef4fd] text-[#1956b8] text-xs font-bold">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{t.residentHome.residentRoleBadge}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Location & Details Info Grid */}
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-[#f8fafc] border border-[#e2e8f0]">
              <Building2 className="w-4 h-4 text-[#1956b8] shrink-0 mt-0.5" />
              <div>
                <strong className="text-xs uppercase font-bold text-[#64748b] block tracking-wide">
                  {t.residentHome.residenceLabel}
                </strong>
                <p className="font-bold text-[#17212f] text-sm mt-0.5">
                  {estateName}
                </p>
                <p className="text-xs text-[#52647a]">
                  {buildingName} • {unitText}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-xl bg-[#f8fafc] border border-[#e2e8f0]">
              <Phone className="w-4 h-4 text-[#1956b8] shrink-0" />
              <div>
                <strong className="text-xs uppercase font-bold text-[#64748b] block tracking-wide">
                  {t.residentHome.phoneLabel}
                </strong>
                <p className="font-medium text-[#17212f] text-sm mt-0.5">
                  {profile?.phone_number || t.residentHome.notRegistered}
                </p>
              </div>
            </div>
          </div>

          {/* Tagline */}
          <div className="text-center py-1">
            <p className="text-xs font-semibold text-[#1956b8]">
              {t.common.tagline}
            </p>
          </div>

          {/* Action Buttons: Sign Out & Close */}
          <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              onClick={() => setConfirmLogout(true)}
              className="flex-1 min-h-[44px] px-4 py-2.5 rounded-xl border border-red-200 bg-red-50/70 hover:bg-red-100 text-[#991b1b] font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4 text-[#991b1b]" />
              <span>{locale === 'ms' ? 'Log keluar' : 'Sign out'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-[#cbd5e1] text-sm font-bold text-[#475569] hover:bg-[#f1f5f9] transition-colors cursor-pointer text-center min-h-[44px]"
            >
              {t.residentHome.closeModal}
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog inside Account Modal */}
      {confirmLogout && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150"
          role="dialog"
          aria-modal="true"
          aria-labelledby="account-confirm-logout-title"
          onClick={() => !isLoggingOut && setConfirmLogout(false)}
        >
          <div
            className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 text-[#991b1b] flex items-center justify-center shrink-0">
                <LogOut className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h2 id="account-confirm-logout-title" className="text-lg font-bold text-[#17212f]">
                  {locale === 'ms' ? 'Anda mahu log keluar?' : 'Would you like to sign out?'}
                </h2>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {locale === 'ms'
                    ? 'Anda boleh log masuk semula bila-bila masa.'
                    : 'You can sign in again whenever you need.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmLogout(false)}
                disabled={isLoggingOut}
                className="flex-1 min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 font-bold text-xs sm:text-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
              >
                {locale === 'ms' ? 'Kekal di sini' : 'Stay here'}
              </button>
              <form action={logoutAction} className="flex-1">
                <button
                  type="submit"
                  disabled={isLoggingOut}
                  onClick={() => setIsLoggingOut(true)}
                  className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#dc2626] hover:bg-[#b91c1c] text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isLoggingOut ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <span>{locale === 'ms' ? 'Log keluar' : 'Sign out'}</span>
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
