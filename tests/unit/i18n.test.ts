import { describe, expect, it } from 'vitest';
import { id } from '../../src/core/i18n/locales/id';
import { en } from '../../src/core/i18n/locales/en';

/** Flattens a nested translation tree into `parent.child` dotted keys. */
function flatten(tree: unknown, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') result[path] = value;
    else Object.assign(result, flatten(value, path));
  }
  return result;
}

const idTree = flatten(id);
const enTree = flatten(en);

/**
 * Indonesian is the source of truth; English must mirror it exactly. TypeScript
 * already enforces the shape, these tests additionally guard runtime integrity
 * and accidental untranslated copy.
 */
describe('translations', () => {
  /** Every Indonesian key must have an English counterpart and vice versa. */
  it('keeps both locales structurally identical', () => {
    expect(Object.keys(enTree).sort()).toEqual(Object.keys(idTree).sort());
  });

  /** Empty strings would render blank labels in the UI. */
  it('has no empty translations', () => {
    const emptyId = Object.entries(idTree).filter(([, value]) => value.trim() === '');
    const emptyEn = Object.entries(enTree).filter(([, value]) => value.trim() === '');
    expect(emptyId).toEqual([]);
    expect(emptyEn).toEqual([]);
  });

  /** Guards against a copied-but-untranslated English locale. */
  it('ships real English copy for most keys', () => {
    const keys = Object.keys(idTree);
    const changed = keys.filter((key) => idTree[key] !== enTree[key]).length;
    expect(changed / keys.length).toBeGreaterThan(0.5);
  });

  /** Interpolation placeholders must match so runtime formatting never breaks. */
  it('uses the same interpolation variables in both languages', () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();
    for (const key of Object.keys(idTree)) {
      expect(placeholders(enTree[key] ?? ''), `placeholders differ for ${key}`).toEqual(
        placeholders(idTree[key] ?? ''),
      );
    }
  });
});
