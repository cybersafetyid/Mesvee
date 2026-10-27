import clsx, { type ClassValue } from 'clsx';

/**
 * Joins conditional class names. Kept intentionally tiny: no runtime CSS engine,
 * no unnecessary dependency, and Tailwind remains the single styling pipeline.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
