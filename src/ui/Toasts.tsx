import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { useAppStore } from '../core/store';
import { cn } from '../lib/cn';

/** Tone-specific icon and hairline colour. */
const TONES = {
  success: { icon: CircleCheck, color: 'text-[var(--success)]' },
  error: { icon: CircleAlert, color: 'text-danger' },
  info: { icon: Info, color: 'text-soft' },
} as const;

/**
 * Fixed toast stack portaled to document.body.
 * Positioned with top-level z-index above all dialogs, backdrops, and overlays.
 */
export function ToastViewport() {
  const { t } = useTranslation();
  const toasts = useAppStore((state) => state.toasts);
  const dismiss = useAppStore((state) => state.dismissToast);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      aria-live="polite"
      aria-label={t('common.appName')}
      className="pointer-events-none fixed right-5 bottom-5 z-[100] flex w-[340px] flex-col gap-2"
    >
      {toasts.map((toast) => {
        const tone = TONES[toast.tone];
        const Icon = tone.icon;
        return (
          <div
            key={toast.id}
            role="status"
            className="glass-strong enter-rise pointer-events-auto flex items-start gap-3 rounded-[16px] p-3.5 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.9)]"
          >
            <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', tone.color)} />
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-medium leading-snug text-ink">{toast.title}</p>
              {toast.description && (
                <p className="mt-1 line-clamp-3 break-words text-[11px] leading-relaxed text-soft">
                  {toast.description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label={t('common.dismiss')}
              className="interactive-ring -mt-1 -mr-1 grid size-6 shrink-0 place-items-center rounded-md text-faint hover:bg-[var(--glass-hover)] hover:text-ink"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
