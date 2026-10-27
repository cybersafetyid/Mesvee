#!/usr/bin/env node
/**
 * Mesvee icon pipeline.
 * A single vector source keeps the app icon, tray glyph and marketing mark in sync.
 * Tauri CLI expands the 1024px master into .icns, .ico and PNG sizes.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const resources = path.join(root, 'resources');
const icons = path.join(root, 'src-tauri', 'icons');

/** Master app icon: a black glass squircle with two overlapping speech bubbles. */
const appIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="tile" x1="180" y1="120" x2="860" y2="920" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#1b1b1e"/>
      <stop offset="0.55" stop-color="#0b0b0d"/>
      <stop offset="1" stop-color="#050506"/>
    </linearGradient>
    <radialGradient id="glow" cx="0" cy="0" r="1" gradientTransform="translate(330 260) rotate(48) scale(620)">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="20"/>
    </filter>
  </defs>
  <rect x="96" y="96" width="832" height="832" rx="196" fill="url(#tile)"/>
  <rect x="96" y="96" width="832" height="832" rx="196" fill="url(#glow)"/>
  <rect x="98" y="98" width="828" height="828" rx="194" fill="none" stroke="#ffffff" stroke-opacity="0.09" stroke-width="4"/>
  <g>
    <path d="M326 294H574C629.2 294 674 338.8 674 394V500C674 555.2 629.2 600 574 600H416L304 678L334 600H326C270.8 600 226 555.2 226 500V394C226 338.8 270.8 294 326 294Z" fill="#F6F6F4"/>
    <circle cx="320" cy="447" r="17" fill="#0A0A0C"/>
    <circle cx="386" cy="447" r="17" fill="#0A0A0C"/>
    <circle cx="452" cy="447" r="17" fill="#0A0A0C"/>
    <path d="M504 462H704C760.3 462 806 507.7 806 564V652C806 708.3 760.3 754 704 754H678L720 812L616 754H504C447.7 754 402 708.3 402 652V564C402 507.7 447.7 462 504 462Z" fill="#08080A" stroke="#F6F6F4" stroke-width="26" stroke-linejoin="round"/>
    <circle cx="604" cy="612" r="14" fill="#F6F6F4"/>
    <circle cx="660" cy="612" r="14" fill="#F6F6F4"/>
    <circle cx="716" cy="612" r="14" fill="#F6F6F4"/>
  </g>
</svg>`;

/** macOS template glyph: pure alpha mask, no container, so the menu bar themes it. */
const trayTemplateSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="88" height="88" viewBox="0 0 88 88">
  <path d="M18 10H46C53 10 58 15 58 22V35C58 42 53 47 46 47H30L17 56L21 47H18C11 47 6 42 6 35V22C6 15 11 10 18 10Z" fill="#000"/>
  <path d="M40 34H62C68 34 73 39 73 45V57C73 63 68 68 62 68H55L61 76L48 68H40C34 68 29 63 29 57V45C29 39 34 34 40 34Z" fill="none" stroke="#000" stroke-width="4"/>
</svg>`;

/** Windows/Linux tray: a high-contrast tile that survives both light and dark trays. */
const trayTileSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect x="2" y="2" width="60" height="60" rx="14" fill="#08080A"/>
  <path d="M17 14H36C41 14 45 18 45 23V31C45 36 41 40 36 40H26L18 46L20 40H17C12 40 8 36 8 31V23C8 18 12 14 17 14Z" fill="#F7F7F6"/>
  <path d="M33 30H47C51 30 54 33 54 37V44C54 48 51 51 47 51H43L47 56L38 51H33C29 51 26 48 26 44V37C26 33 29 30 33 30Z" fill="#08080A" stroke="#F7F7F6" stroke-width="2.5"/>
</svg>`;

await mkdir(resources, { recursive: true });
await mkdir(icons, { recursive: true });

await writeFile(path.join(resources, 'icon.svg'), appIconSvg.trim());
await writeFile(path.join(resources, 'tray-template.svg'), trayTemplateSvg.trim());

// Render the 1024px master used by the Tauri CLI to create every bundle asset.
await sharp(Buffer.from(appIconSvg)).png().resize(1024, 1024).toFile(path.join(resources, 'icon.png'));
// Tray assets are intentionally small; the OS expects template images to be alpha-only.
await sharp(Buffer.from(trayTemplateSvg)).png().resize(44, 44).toFile(path.join(icons, 'trayTemplate.png'));
await sharp(Buffer.from(trayTemplateSvg)).png().resize(88, 88).toFile(path.join(icons, 'trayTemplate@2x.png'));
await sharp(Buffer.from(trayTileSvg)).png().resize(64, 64).toFile(path.join(icons, 'tray.png'));
await sharp(Buffer.from(trayTileSvg)).png().resize(128, 128).toFile(path.join(icons, 'tray@2x.png'));

// The Tauri CLI is the source of truth for .icns/.ico/PNG platform packaging.
const tauri = spawnSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'tauri', 'icon', path.join(resources, 'icon.png'), '-o', icons],
  { cwd: root, stdio: 'inherit' },
);
if (tauri.status !== 0) {
  throw new Error(`tauri icon failed with status ${tauri.status}`);
}

// eslint-disable-next-line no-console
console.log('Mesvee icons generated in resources/ and src-tauri/icons/');
