import { cn } from '../lib/cn';

/** Props for the accessible on/off switch used throughout settings. */
export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  id?: string;
  className?: string;
}

/**
 * Native-button switch with role="switch". The visual track stays monochrome:
 * on is solid ink, off is recessed glass, which keeps the glassmorphism calm.
 */
export function Switch({ checked, onChange, disabled, label, id, className }: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[26px] w-[46px] shrink-0 items-center rounded-full border p-[3px]',
        'interactive-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
        'disabled:pointer-events-none disabled:opacity-40',
        checked
          ? 'border-transparent bg-accent'
          : 'border-line bg-[var(--glass)] hover:border-line-strong',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'block size-5 rounded-full shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
          checked
            ? 'translate-x-[20px] bg-[var(--accent-ink)]'
            : 'translate-x-0 bg-[var(--text-secondary)]',
        )}
      />
    </button>
  );
}

/** One option in a segmented control. */
export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/** Props for the segmented control. */
export interface SegmentedProps<T extends string> {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  label: string;
  className?: string;
}

/**
 * Compact segmented picker with a sliding indicator. It is used for theme,
 * language, density and other small enumerations where a select feels heavy.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  label,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'relative inline-flex rounded-[12px] border border-line bg-[var(--glass)] p-[3px]',
        disabled && 'pointer-events-none opacity-45',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.hint}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative z-10 h-7 rounded-[9px] px-3 text-[12px] font-medium transition-colors duration-200',
              active
                ? 'bg-accent text-accent-ink shadow-sm'
                : 'text-soft hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Props for the centered busy indicator. */
export interface SpinnerProps {
  size?: number;
  className?: string;
  label?: string;
}

/** Monochrome loading ring used for full-panel and inline waits. */
export function Spinner({ size = 18, className, label }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label ?? 'Loading'}
      className={cn('inline-block animate-spin rounded-full border-2', className)}
      style={{
        width: size,
        height: size,
        borderColor: 'var(--border-strong)',
        borderTopColor: 'var(--accent)',
        animationDuration: '760ms',
      }}
    />
  );
}

/** Props for the small equalizer used while a service boots. */
export interface EqualizerProps {
  className?: string;
}

/**
 * Decorative equalizer communicates "connecting" without a generic spinner,
 * and inherits its colour from the surrounding text.
 */
export function Equalizer({ className }: EqualizerProps) {
  return (
    <span className={cn('equalizer', className)} aria-hidden>
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}
