import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';
import { IconButton } from './Button';

/** Props for the shared dialog. */
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** Optional: confirmation dialogs carry all of their copy in the header. */
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  dismissible?: boolean;
  className?: string;
  /** Hides the header when a dialog wants a fully custom composition. */
  bare?: boolean;
}

/** Width classes for the three supported dialog sizes. */
const SIZES = {
  sm: 'max-w-[420px]',
  md: 'max-w-[560px]',
  lg: 'max-w-[780px]',
} as const;

/**
 * Portal dialog with Escape dismissal, backdrop clicks, initial focus, focus
 * trapping and focus restoration. Native service webviews are hidden by their
 * parent before a dialog opens, otherwise they would paint above the portal.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
  className,
  bare = false,
}: ModalProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    /** Keeps Tab navigation inside the dialog while it is open. */
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissibleRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const frame = requestAnimationFrame(() => {
      const autofocus = panelRef.current?.querySelector<HTMLElement>('[data-autofocus]');
      (autofocus ?? panelRef.current)?.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissible) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mesvee-dialog-title"
        aria-describedby={description ? 'mesvee-dialog-description' : undefined}
        tabIndex={-1}
        className={cn(
          'glass-strong enter-scale w-full overflow-hidden rounded-[var(--radius-xl)] shadow-[0_50px_140px_-50px_rgba(0,0,0,0.95)] outline-none',
          SIZES[size],
          className,
        )}
      >
        {!bare && (
          <header className="flex items-start justify-between gap-6 px-6 pt-5 pb-4">
            <div className="min-w-0">
              <h2
                id="mesvee-dialog-title"
                className="text-[17px] font-semibold tracking-[-0.03em] text-ink"
              >
                {title}
              </h2>
              {description && (
                <p
                  id="mesvee-dialog-description"
                  className="mt-1.5 text-pretty text-[12.5px] leading-relaxed text-soft"
                >
                  {description}
                </p>
              )}
            </div>
            {dismissible && (
              <IconButton label={t('common.close')} onClick={onClose} className="-mt-1 -mr-1 shrink-0">
                <X />
              </IconButton>
            )}
          </header>
        )}
        {children && <div className={cn('px-6 pb-6', bare && 'p-0')}>{children}</div>}
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--glass)] px-6 py-3.5">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
