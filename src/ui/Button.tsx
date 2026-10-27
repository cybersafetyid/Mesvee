import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cn } from '../lib/cn';

/** Visual weight shared by every Mesvee button. */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
/** Control height used across toolbars, forms and dialogs. */
type ButtonSize = 'sm' | 'md' | 'lg';

/** Props for the shared button primitive. */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

/** Variant classes keep the monochrome glass language consistent everywhere. */
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-ink border border-transparent hover:opacity-90 shadow-[0_10px_30px_-16px_rgba(0,0,0,0.9)]',
  secondary:
    'glass text-ink border border-line hover:bg-[var(--glass-hover)] hover:border-line-strong',
  ghost:
    'bg-transparent text-soft border border-transparent hover:bg-[var(--glass)] hover:text-ink',
  danger:
    'bg-transparent text-danger border border-[color-mix(in_srgb,var(--danger)_38%,transparent)] hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]',
};

/** Size classes intentionally leave room for comfortable pointer targets. */
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 rounded-[10px] px-3 text-[12.5px]',
  md: 'h-10 gap-2 rounded-[12px] px-4 text-[13px]',
  lg: 'h-12 gap-2.5 rounded-[14px] px-5 text-sm',
};

/**
 * Shared button primitive. It owns loading and disabled semantics so screens
 * never need to reimplement busy states or duplicate focus affordances.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  iconRight,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'interactive-ring inline-flex select-none items-center justify-center font-medium tracking-[-0.01em]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
      ) : (
        icon && <span className="shrink-0 [&_svg]:size-4">{icon}</span>
      )}
      {children && <span className="truncate">{children}</span>}
      {iconRight && !loading && (
        <span className="shrink-0 opacity-60 [&_svg]:size-4">{iconRight}</span>
      )}
    </button>
  );
}

/** Props for a square, icon-only control. */
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: 'sm' | 'md';
  active?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * Icon-only button with a mandatory accessible label. Used in title bars,
 * toolbars and card actions where text would crowd the composition.
 */
export function IconButton({
  label,
  size = 'md',
  active = false,
  className,
  children,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'interactive-ring inline-flex items-center justify-center rounded-[10px] text-soft',
        'hover:bg-[var(--glass-hover)] hover:text-ink',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
        'disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'size-7 [&_svg]:size-3.5' : 'size-9 [&_svg]:size-4',
        active && 'bg-[var(--glass-hover)] text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
