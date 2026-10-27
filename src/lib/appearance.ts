import type { MotionPreference, Settings, Theme } from '../core/types';

/** The concrete palette after resolving the "system" preference. */
export type ResolvedTheme = 'dark' | 'light';

/** Reads the OS colour preference without assuming a browser API is present. */
export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Resolves a stored theme preference into the palette that should render. */
export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return theme;
}

/** Reflects the resolved palette on the root element for CSS tokens. */
export function applyTheme(theme: Theme): ResolvedTheme {
  const resolved = resolveTheme(theme);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  return resolved;
}

/** Reflects motion and density choices as data attributes consumed by CSS. */
export function applyInterfacePreferences(
  motion: MotionPreference,
  density: Settings['appearance']['density'],
): void {
  const reduced =
    motion === 'reduce' ||
    (motion === 'system' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  document.documentElement.dataset.motion = reduced ? 'reduce' : 'full';
  document.documentElement.dataset.density = density;
}

/** Subscribes to OS palette changes; returns an unsubscribe function. */
export function watchSystemTheme(onChange: () => void): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
