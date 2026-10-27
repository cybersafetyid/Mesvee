#!/usr/bin/env node
/**
 * Prints the CHANGELOG.md section for one version to stdout. The release
 * workflow uses it as the GitHub release body, which tauri-action also copies
 * into `latest.json` as the in-app update notes.
 *
 * Usage: node scripts/release-notes.mjs <version>   (a leading "v" is accepted)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSection } from './lib/changelog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = (process.argv[2] ?? '').replace(/^v/, '');
if (!version) {
  console.error('usage: node scripts/release-notes.mjs <version>');
  process.exit(1);
}

const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
const section = extractSection(changelog, version);
if (!section) {
  console.error(`error: no CHANGELOG.md section for ${version}`);
  process.exit(1);
}
console.log(section);
