import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';

/** Shared input surface used by fields and standalone controls. */
const CONTROL =
  'w-full rounded-[12px] border border-line bg-[var(--glass)] px-3 text-[13px] text-ink placeholder:text-faint ' +
  'outline-none transition-all duration-150 hover:border-line-strong ' +
  'focus:border-line-strong focus:ring-2 focus:ring-[var(--accent)]/20 focus:outline-none ' +
  'disabled:opacity-45 disabled:pointer-events-none';

/** Props for a text input. */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
}

/** Text input with optional leading/trailing adornments. */
export function Input({ className, invalid, leading, trailing, ...rest }: InputProps) {
  if (!leading && !trailing) {
    return (
      <input
        className={cn(
          CONTROL,
          'h-10',
          invalid &&
            'border-[var(--danger)] hover:border-[var(--danger)] focus:border-[var(--danger)] focus:ring-[var(--danger)]/25',
          className,
        )}
        aria-invalid={invalid || undefined}
        {...rest}
      />
    );
  }
  return (
    <div
      className={cn(
        'flex h-10 items-center gap-2 rounded-[12px] border border-line bg-[var(--glass)] px-3 text-[13px] text-ink',
        // The ring belongs to the whole field, not the bare input inside it,
        // so it wraps cleanly around leading/trailing adornments.
        'transition-all duration-150 hover:border-line-strong',
        'focus-within:border-line-strong focus-within:ring-2 focus-within:ring-[var(--accent)]/20',
        invalid &&
          'border-[var(--danger)] hover:border-[var(--danger)] focus-within:border-[var(--danger)] focus-within:ring-[var(--danger)]/25',
        className,
      )}
    >
      {leading && <span className="shrink-0 text-faint [&_svg]:size-4">{leading}</span>}
      <input
        className="field-control h-full min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
        aria-invalid={invalid || undefined}
        {...rest}
      />
      {trailing && <span className="shrink-0 text-faint [&_svg]:size-4">{trailing}</span>}
    </div>
  );
}

/** Props for the styled native select. */
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[];
}

/**
 * Native select for long enumerations. Styling the trigger keeps the glass
 * language while the OS still renders a familiar, accessible menu.
 */
export function Select({ options, className, ...rest }: SelectProps) {
  return (
    <div className={cn('relative inline-flex', className)}>
      <select
        className={cn(
          CONTROL,
          'h-9 cursor-pointer appearance-none bg-[var(--glass-strong)] py-0 pr-8 pl-3 text-[12.5px]',
        )}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-[var(--bg-raised)] text-ink">
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-faint"
      />
    </div>
  );
}

/** Props for a labelled field block. */
export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

/** Labelled field wrapper used by onboarding, lock and settings forms. */
export function Field({ label, hint, error, htmlFor, children, className }: FieldProps) {
  const generatedId = useId();
  const target = htmlFor ?? generatedId;
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={target} className="text-[12.5px] font-medium text-ink">
          {label}
        </label>
        {hint && <span className="text-[11px] text-faint">{hint}</span>}
      </div>
      {children}
      {error && (
        <p role="alert" className="text-[11.5px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Props for a single settings row. */
export interface SettingRowProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
  danger?: boolean;
}

/**
 * One preference row: title and explanation on the left, control on the right.
 * Rows are separated by a hairline in the parent card rather than each owning
 * a border, which avoids doubled lines.
 */
export function SettingRow({ title, description, icon, children, className, danger }: SettingRowProps) {
  return (
    <div className={cn('flex items-center gap-4 py-3.5', className)}>
      {icon && (
        <span
          aria-hidden
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-[10px] border border-line bg-[var(--glass)] text-soft [&_svg]:size-4',
            danger && 'text-danger',
          )}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className={cn('text-[13px] font-medium text-ink', danger && 'text-danger')}>{title}</p>
        {description && <p className="mt-0.5 text-pretty text-[11.5px] leading-relaxed text-faint">{description}</p>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

/** Props for a settings group card. */
export interface SettingsCardProps {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  divided?: boolean;
}

/** Glass card that groups related settings and optional header actions. */
export function SettingsCard({
  title,
  description,
  action,
  children,
  className,
  divided = true,
}: SettingsCardProps) {
  return (
    <section
      className={cn(
        'rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--glass)] shadow-[var(--shadow-glass)] p-4',
        className,
      )}
    >
      {(title || action) && (
        <header className="mb-2 flex items-start justify-between gap-4">
          <div>
            {title && <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>}
            {description && <p className="mt-1 text-pretty text-[11.5px] leading-relaxed text-faint">{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={cn(divided && 'divide-y divide-[var(--border)]')}>{children}</div>
    </section>
  );
}

/** Props for a multiline text input. */
export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

/** Multiline input for release notes and diagnostics notes. */
export function TextArea({ className, ...rest }: TextAreaProps) {
  return <textarea className={cn(CONTROL, 'min-h-24 resize-none py-2.5 leading-relaxed', className)} {...rest} />;
}

/** Keyboard shortcut chip. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-[5px] border border-line bg-[var(--glass)] px-1',
        'font-mono text-[9.5px] font-medium text-faint',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
