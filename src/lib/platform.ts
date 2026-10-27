export type Platform = 'macos' | 'windows' | 'linux' | 'web';

/**
 * Detects the native platform. The renderer still receives the authoritative
 * value in the bootstrap payload; this helper is only for first-paint chrome.
 */
export function detectPlatform(): Platform {
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes('mac')) return 'macos';
  if (userAgent.includes('win')) return 'windows';
  if (userAgent.includes('linux')) return 'linux';
  return 'web';
}

/** True when the React app is running inside the Tauri webview. */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Platform-aware command modifier shown in keyboard hints. */
export function commandModifier(platform: Platform): string {
  return platform === 'macos' ? '⌘' : 'Ctrl';
}
