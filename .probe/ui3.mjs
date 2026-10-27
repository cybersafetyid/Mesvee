import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'id-ID' });
await page.goto('http://127.0.0.1:1420/?fresh=1', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.screenshot({ path: 'screenshots/16-home-rail.png' });
const rail = await page.locator('nav[aria-label]').first().boundingBox();
const header = await page.locator('header').first().boundingBox();
const controls = await page.evaluate(() => {
  const dots = [...document.querySelectorAll('header button[aria-label]')].filter((b) => /Tutup|Perkecil|Perbesar|Minimize|Close|Maximize/.test(b.getAttribute('aria-label') || ''));
  return dots.map((d) => ({ label: d.getAttribute('aria-label'), box: d.getBoundingClientRect().toJSON() }));
});
console.log(JSON.stringify({ rail, header, controls }, null, 2));
await browser.close();
