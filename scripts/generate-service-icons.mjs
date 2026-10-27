#!/usr/bin/env node
/**
 * Regenerates `src/ui/service-icons.generated.ts` from the installed
 * `simple-icons` package (CC0 licensed brand silhouettes).
 *
 * The Mesvee design language is strictly monochrome, so brand glyphs are
 * exported as raw path data and rendered as single-colour silhouettes instead
 * of the original multicolour marks.
 *
 * Usage: node scripts/generate-service-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import * as simpleIcons from 'simple-icons';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'src/ui/service-icons.generated.ts');

/**
 * Catalog kind → simple-icons export name.
 * Kinds that simple-icons no longer ships (brand policy removals) are handled
 * by hand-drawn fallbacks in `src/ui/ServiceIcon.tsx` and are intentionally
 * absent here.
 */
const ICON_MAP = {
  whatsapp: 'siWhatsapp',
  telegram: 'siTelegram',
  messenger: 'siMessenger',
  instagram: 'siInstagram',
  x: 'siX',
  discord: 'siDiscord',
  element: 'siElement',
  googleChat: 'siGooglechat',
  facebook: 'siFacebook',
  threads: 'siThreads',
  bluesky: 'siBluesky',
  tiktok: 'siTiktok',
  youtube: 'siYoutube',
  reddit: 'siReddit',
  signal: 'siSignal',
};

/** Resolves every mapping, failing loudly when an upstream icon disappears. */
const entries = [];
const missing = [];
for (const [kind, exportName] of Object.entries(ICON_MAP)) {
  const icon = simpleIcons[exportName];
  if (!icon || typeof icon.path !== 'string') {
    missing.push(`${exportName} (kind: ${kind})`);
    continue;
  }
  entries.push(`  ${kind}: ${JSON.stringify(icon.path)},`);
}

if (missing.length > 0) {
  console.error(`error: missing simple-icons exports:\n  ${missing.join('\n  ')}`);
  console.error('update ICON_MAP or add a fallback glyph in ServiceIcon.tsx');
  process.exit(1);
}

const source = `/**
 * Official brand glyph paths for the service switcher.
 * Generated from simple-icons (CC0) by scripts/generate-service-icons.mjs —
 * do not edit by hand; rerun the script instead.
 * Paths are rendered as monochrome silhouettes so the glass UI stays black and white.
 */
export const SERVICE_ICON_PATHS: Record<string, string> = {
${entries.join('\n')}
};
`;

fs.writeFileSync(OUTPUT, source);
console.log(`wrote ${entries.length} glyph paths to ${path.relative(ROOT, OUTPUT)}`);
