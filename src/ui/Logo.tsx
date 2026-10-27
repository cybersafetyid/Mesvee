import { cn } from '../lib/cn';

/** Props for the Mesvee brand mark. */
export interface LogoProps {
  size?: number;
  withWordmark?: boolean;
  className?: string;
  wordmarkClassName?: string;
}

/**
 * Mesvee brand mark: two overlapping conversation bubbles, one solid and one
 * outlined. The overlap represents many networks becoming one calm surface.
 * It inherits currentColor so it can sit on any monochrome glass layer.
 */
export function Logo({ size = 26, withWordmark = false, className, wordmarkClassName }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)} aria-label="Mesvee">
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden
        className="shrink-0"
      >
        <path
          d="M2.9 9.3A6.4 6.4 0 0 1 9.3 2.9h5.9a6.4 6.4 0 0 1 6.4 6.4v2.8a6.4 6.4 0 0 1-6.4 6.4H11l-5.6 3.9c-.9.6-2.1 0-2.1-1L2.9 9.3Z"
          fill="currentColor"
        />
        <path
          d="M12.6 18.2a6.4 6.4 0 0 1 6.4-6.4h4.7a6.4 6.4 0 0 1 6.4 6.4v5.7c0 1-1.2 1.6-2.1 1L22 21.1h-3a6.4 6.4 0 0 1-6.4-6.4"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinejoin="round"
        />
      </svg>
      {withWordmark && (
        <span
          className={cn(
            'relative -top-[1px] text-[17px] font-semibold leading-none tracking-[-0.045em] text-ink',
            wordmarkClassName,
          )}
        >
          mesvee
        </span>
      )}
    </span>
  );
}
