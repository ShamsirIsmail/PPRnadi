'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, AlertTriangle, Loader2 } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/LanguageContext';

export interface LightboxImage {
  id: string;
  file_name: string;
  signedUrl?: string;
}

interface PhotoLightboxModalProps {
  images: LightboxImage[];
  initialIndex: number;
  isOpen: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
  getTriggerElement?: (index: number) => HTMLElement | null;
}

export function PhotoLightboxModal({
  images,
  initialIndex,
  isOpen,
  onClose,
  triggerRef,
  getTriggerElement,
}: PhotoLightboxModalProps) {
  const { t } = useTranslation();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');

  const modalRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const prevFocusedRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  // Sync index when initialIndex changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(Math.max(0, Math.min(initialIndex, images.length - 1)));
      setLoadState('loading');
    }
  }, [isOpen, initialIndex, images.length]);

  // Reset load state when navigating between images
  useEffect(() => {
    setLoadState('loading');
  }, [currentIndex]);

  // Focus trap and restore
  useEffect(() => {
    if (!isOpen) {
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        const target =
          triggerRef?.current ||
          (getTriggerElement ? getTriggerElement(currentIndex) : null) ||
          prevFocusedRef.current;
        setTimeout(() => {
          target?.focus?.();
        }, 10);
      }
      return;
    }

    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      prevFocusedRef.current = document.activeElement as HTMLElement | null;
      setTimeout(() => {
        closeBtnRef.current?.focus();
      }, 50);
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setCurrentIndex((prev) => (prev > 0 ? prev - 1 : prev));
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : prev));
        return;
      }

      // Simple focus trap
      if (e.key === 'Tab' && modalRef.current) {
        const focusables = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex="0"]'
        );
        if (focusables.length === 0) return;

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, currentIndex, getTriggerElement, triggerRef, onClose, images.length]);

  const handlePrev = useCallback(() => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : prev));
  }, []);

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : prev));
  }, [images.length]);

  if (!isOpen || images.length === 0) return null;

  const currentImage = images[currentIndex];
  const hasMultiple = images.length > 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="lightbox-modal"
      aria-label={t.history.detailEvidenceTitle}
      ref={modalRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 select-none backdrop-blur-xs transition-opacity duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Top action bar */}
      <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between text-white z-10 bg-linear-to-b from-black/70 to-transparent">
        <div
          data-testid="lightbox-counter"
          className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-xs"
        >
          {currentIndex + 1} {t.history.lightboxCounter} {images.length}
        </div>
        <button
          ref={closeBtnRef}
          type="button"
          onClick={onClose}
          aria-label={t.history.lightboxClose}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition-all text-white focus:outline-hidden focus:ring-2 focus:ring-white"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Main Image Area */}
      <div className="relative max-w-3xl max-h-[80vh] w-full flex items-center justify-center">
        {loadState === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/70 space-y-2">
            <Loader2 className="w-8 h-8 animate-spin text-[#60A5FA]" />
            <span className="text-xs font-medium">{t.history.lightboxLoading}</span>
          </div>
        )}

        {loadState === 'error' || !currentImage?.signedUrl ? (
          <div className="p-8 text-center bg-white/5 rounded-2xl border border-white/10 text-white/80 space-y-2 max-w-sm">
            <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto" />
            <p className="text-sm font-semibold">{t.history.lightboxError}</p>
            <p className="text-xs text-white/50">{currentImage?.file_name}</p>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentImage.signedUrl}
            alt={currentImage.file_name || `${t.history.detailEvidenceTitle} ${currentIndex + 1}`}
            onLoad={() => setLoadState('loaded')}
            onError={() => setLoadState('error')}
            className={`max-w-full max-h-[75vh] object-contain rounded-lg shadow-2xl transition-opacity duration-200 ${
              loadState === 'loaded' ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}
      </div>

      {/* Navigation Controls (Left / Right) */}
      {hasMultiple && (
        <>
          <button
            type="button"
            onClick={handlePrev}
            disabled={currentIndex === 0}
            aria-label={t.history.lightboxPrev}
            className={`absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 min-h-[48px] min-w-[48px] flex items-center justify-center rounded-full bg-black/50 text-white border border-white/20 backdrop-blur-xs transition-all ${
              currentIndex === 0
                ? 'opacity-30 cursor-not-allowed'
                : 'hover:bg-white/20 active:scale-95'
            }`}
          >
            <ChevronLeft className="w-6 h-6" />
          </button>

          <button
            type="button"
            onClick={handleNext}
            disabled={currentIndex === images.length - 1}
            aria-label={t.history.lightboxNext}
            className={`absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 min-h-[48px] min-w-[48px] flex items-center justify-center rounded-full bg-black/50 text-white border border-white/20 backdrop-blur-xs transition-all ${
              currentIndex === images.length - 1
                ? 'opacity-30 cursor-not-allowed'
                : 'hover:bg-white/20 active:scale-95'
            }`}
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </>
      )}

      {/* Bottom filename caption */}
      <div className="absolute bottom-4 left-4 right-4 text-center pointer-events-none">
        <p className="text-xs text-white/60 truncate max-w-md mx-auto">
          {currentImage?.file_name}
        </p>
      </div>
    </div>
  );
}
