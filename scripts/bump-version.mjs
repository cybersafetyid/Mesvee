#!/usr/bin/env node
/**
 * Bumps the application version across every manifest that carries it.
 *
 * Mesvee ships updater signatures and platform bundles, so a version must be
 * consistent in one atomic step: package.json, tauri.conf.json, Cargo.toml and
 * Cargo.lock (plus package-lock.json when present). A mismatched manifest makes
 * the updater compare the wrong version or Cargo refuse to build.
 *
 * It also prepends a CHANGELOG.md entry generated from the Conventional Commits
 * since the last `v*` tag, then commits, tags and pushes. The pushed tag starts
 * the release workflow (.github/workflows/release.yml).
 *
 * Usage:
 *   node scripts/bump-version.mjs <patch|minor|major> [--dry-run] [--no-push] [--no-git]
 *     --dry-run  preview the bump and changelog entry, write nothing
 *     --no-push  commit and tag locally but do not push
 *     --no-git   only edit files (no changelog commit, tag or push)
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import { commitsSince, git, isGitRepo, lastTag, prependEntry, renderEntry, repoUrl } from './lib/changelog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [bumpType, ...flags] = process.argv.slice(2);
const dryRun = flags.includes('--dry-run');
const noPush = flags.includes('--no-push');
const noGit = flags.includes('--no-git');

/** Fails loudly with usage information instead of writing a broken version. */
function usage(message) {
  console.error(`error: ${message}`);
  console.error('usage: node scripts/bump-version.mjs <patch|minor|major> [--dry-run] [--no-push] [--no-git]');
  process.exit(1);
}

if (!['patch', 'minor', 'major'].includes(bumpType)) {
  usage('bump type must be one of: patch, minor, major');
}
for (const flag of flags) {
  if (!['--dry-run', '--no-push', '--no-git'].includes(flag)) usage(`unknown flag: ${flag}`);
}

/** Reads a JSON manifest relative to the repository root. */
function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
}

const packageJson = readJson('package.json');
const current = semver.valid(packageJson.version);
if (!current) usage(`package.json version "${packageJson.version}" is not valid semver`);

const next = semver.inc(current, bumpType);
if (!next) usage(`could not compute the next ${bumpType} version`);

/** Replaces a version assignment inside one `[section]` of an INI-style file. */
function bumpIniSection(source, section, version) {
  const start = source.indexOf(`[${section}]`);
  if (start === -1) throw new Error(`section [${section}] not found`);
  const head = source.slice(0, start);
  const body = source.slice(start);
  const updated = body.replace(/(^version\s*=\s*)"[^"]+"/m, (match, prefix) => `${prefix}"${version}"`);
  if (updated === body) throw new Error(`version field not found in [${section}]`);
  return head + updated;
}

/** Replaces the `version` that follows `name = "mesvee"` in Cargo.lock. */
function bumpCargoLock(source, version) {
  const nameIndex = source.indexOf('name = "mesvee"');
  if (nameIndex === -1) throw new Error('mesvee package not found in Cargo.lock');
  const updated = source.replace(
    new RegExp(`(name = "mesvee"\\nversion = ")[^"]+(")`),
    `$1${version}$2`,
  );
  if (updated === source) throw new Error('Cargo.lock version field not found');
  return updated;
}

/**
 * Builds every new file body up front. Any failure happens before the first
 * write, so the bump is all-or-nothing.
 */
const edits = [];

packageJson.version = next;

const tauriConf = readJson('src-tauri/tauri.conf.json');
tauriConf.version = next;

edits.push({ relative: 'package.json', body: `${JSON.stringify(packageJson, null, 2)}\n` });
// The project uses pnpm (no package-lock.json); keep npm's lockfile in sync only if one exists.
if (fs.existsSync(path.join(ROOT, 'package-lock.json'))) {
  const lockJson = readJson('package-lock.json');
  lockJson.version = next;
  if (lockJson.packages && lockJson.packages['']) lockJson.packages[''].version = next;
  edits.push({ relative: 'package-lock.json', body: `${JSON.stringify(lockJson, null, 2)}\n` });
}
edits.push({ relative: 'src-tauri/tauri.conf.json', body: `${JSON.stringify(tauriConf, null, 2)}\n` });
edits.push({
  relative: 'src-tauri/Cargo.toml',
  body: bumpIniSection(fs.readFileSync(path.join(ROOT, 'src-tauri/Cargo.toml'), 'utf8'), 'package', next),
});
edits.push({
  relative: 'src-tauri/Cargo.lock',
  body: bumpCargoLock(fs.readFileSync(path.join(ROOT, 'src-tauri/Cargo.lock'), 'utf8'), next),
});

const useGit = !noGit && isGitRepo(ROOT);
if (!noGit && !useGit) console.warn('warning: not a git repository — skipping changelog, commit, tag and push');

// Uncommitted work would be missing from the changelog and swept into the release commit.
if (useGit && !dryRun && git(ROOT, 'status', '--porcelain')) {
  usage('working tree is not clean — commit or stash your changes before bumping');
}

// Changelog entry from the commits since the previous release tag.
let entryText = null;
const changelogPath = path.join(ROOT, 'CHANGELOG.md');
if (useGit) {
  const previousTag = lastTag(ROOT);
  const entry = renderEntry({
    version: next,
    date: new Date().toISOString().slice(0, 10),
    commits: commitsSince(ROOT, previousTag),
    repo: repoUrl(ROOT),
    previousTag,
  });
  const existing = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : '';
  entryText = entry;
  edits.push({ relative: 'CHANGELOG.md', body: prependEntry(existing, entry) });
}

console.log(`mesvee: ${current} → ${next} (${bumpType})`);

if (dryRun) {
  for (const edit of edits) console.log(`  would update ${edit.relative}`);
  if (entryText) console.log(`\n--- CHANGELOG entry ---\n${entryText}`);
  console.log('  dry run — nothing written');
  process.exit(0);
}

// Every body was built successfully above, so writing cannot fail halfway.
for (const edit of edits) {
  fs.writeFileSync(path.join(ROOT, edit.relative), edit.body);
  console.log(`  updated ${edit.relative}`);
}

if (!useGit) {
  console.log('done. commit the bump, then tag v' + next);
  process.exit(0);
}

// Commit + tag + push. The tag push is what triggers the release build.
const tag = `v${next}`;
const run = (...args) => {
  if (git(ROOT, ...args) === null) {
    console.error(`error: \`git ${args.join(' ')}\` failed — files are bumped; finish the release by hand`);
    process.exit(1);
  }
};
run('add', ...edits.map((e) => e.relative));
run('commit', '-m', `chore(release): ${tag}`);
run('tag', '-a', tag, '-m', `Mesvee ${next}`);
console.log(`  committed and tagged ${tag}`);

if (noPush || !git(ROOT, 'remote')) {
  console.log(noPush ? `done. push with: git push origin HEAD ${tag}` : `done. no remote configured — add one, then: git push origin HEAD ${tag}`);
} else {
  run('push', 'origin', 'HEAD', tag);
  console.log(`  pushed HEAD and ${tag} to origin — the release workflow is starting`);
}
