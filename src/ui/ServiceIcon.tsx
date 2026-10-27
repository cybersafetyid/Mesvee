import { Hash, Mail, MessageSquare, Users } from 'lucide-react';
import { SERVICE_ICON_PATHS } from './service-icons.generated';
import { cn } from '../lib/cn';

/** Props for a service brand glyph. */
export interface ServiceIconProps {
  kind: string;
  size?: number;
  className?: string;
}

/**
 * Draws a service logo as a single-colour silhouette. Most glyphs come from
 * simple-icons; brands removed from that package are approximated with clear
 * geometric fallbacks so the catalog never shows a blank tile.
 */
export function ServiceIcon({ kind, size = 20, className }: ServiceIconProps) {
  const path = SERVICE_ICON_PATHS[kind];

  if (path) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden
        className={cn('shrink-0', className)}
        fill="currentColor"
      >
        <path d={path} />
      </svg>
    );
  }

  // LinkedIn has no current simple-icons entry; this "in" lockup keeps it legible.
  if (kind === 'linkedin') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden
        className={cn('shrink-0', className)}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      >
        <path d="M6.4 9.6v8.2" />
        <circle cx="6.4" cy="5.9" r="1.15" fill="currentColor" stroke="none" />
        <path d="M11.4 17.8V9.6m0 3.1a3.05 3.05 0 0 1 6.1 0v5.1" />
      </svg>
    );
  }

  const Fallback = kind === 'slack' ? Hash : kind === 'teams' ? Users : kind === 'gmail' ? Mail : MessageSquare;

  return <Fallback size={size} strokeWidth={1.8} aria-hidden className={cn('shrink-0', className)} />;
}
