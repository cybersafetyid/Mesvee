import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyInterfacePreferences,
  applyTheme,
  resolveTheme,
  watchSystemTheme,
} from '../../src/lib/appearance';

/** Minimal DOM/window stubs so appearance helpers run in the node environment. */
interface StubbedMatchMedia {
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  matches: boolean;
}

let media: StubbedMatchMedia;
let root: { dataset: Record<string, string>; style: Record<string, string> };

beforeEach(() => {
  media = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  root = { dataset: {}, style: {} };
  (globalThis as { window?: unknown }).window = {
    matchMedia: () => media,
  };
  (globalThis as { document?: unknown }).document = { documentElement: root };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
});

/**
 * Theme mode must resolve predictably: explicit modes never consult the OS and
 * "system" mode always follows it.
 */
describe('resolveTheme', () => {
  /** Explicit palette choices are authoritative. */
  it('honours explicit themes regardless of the OS preference', () => {
    media.matches = true;
    expect(resolveTheme('light')).toBe('light');
    media.matches = false;
    expect(resolveTheme('dark')).toBe('dark');
  });

  /** System mode delegates to the OS colour scheme. */
  it('follows the OS when set to system', () => {
    media.matches = true;
    expect(resolveTheme('system')).toBe('dark');
    media.matches = false;
    expect(resolveTheme('system')).toBe('light');
  });
});

describe('applyTheme', () => {
  /** The root element drives every CSS token, so it must be updated. */
  it('writes the resolved palette onto the root element', () => {
    expect(applyTheme('dark')).toBe('dark');
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
  });
});

describe('applyInterfacePreferences', () => {
  /** Motion "system" must map onto the reduce/full data attribute. */
  it('maps system motion onto the reduce preference', () => {
    media.matches = true; // prefers-reduced-motion: reduce
    applyInterfacePreferences('system', 'compact');
    expect(root.dataset.motion).toBe('reduce');
    expect(root.dataset.density).toBe('compact');
  });

  /** An explicit full-motion choice overrides the OS setting. */
  it('keeps full motion when explicitly chosen', () => {
    media.matches = true;
    applyInterfacePreferences('full', 'comfortable');
    expect(root.dataset.motion).toBe('full');
    expect(root.dataset.density).toBe('comfortable');
  });
});

describe('watchSystemTheme', () => {
  /** Subscribing registers, and the returned handle unsubscribes cleanly. */
  it('registers and removes the OS palette listener', () => {
    const stop = watchSystemTheme(() => undefined);
    expect(media.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    stop();
    expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
