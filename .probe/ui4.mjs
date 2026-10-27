import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'id-ID' });
await page.addInitScript(() => {
  window.localStorage.setItem('mesvee.mock.settings.v1', JSON.stringify({ onboarded: true }));
});
await page.goto('http://127.0.0.1:1420', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'Pengaturan', exact: true }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: 'screenshots/17-settings-cards.png' });
await page.getByRole('button', { name: 'Tampilan', exact: true }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: 'screenshots/18-settings-appearance.png' });
// service screen alignment check
await page.getByRole('button', { name: 'Kembali ke aplikasi' }).click();
await page.waitForTimeout(300);
await page.locator('button[aria-label*="WhatsApp"]').first().click();
await page.waitForTimeout(600);
const boxes = await page.evaluate(() => {
  const nav = document.querySelector('nav[aria-label]')?.getBoundingClientRect();
  const surface = document.querySelector('.service-surface')?.getBoundingClientRect();
  return { nav, surface };
});
await page.screenshot({ path: 'screenshots/19-service-aligned.png' });
console.log(JSON.stringify(boxes, null, 2));
await browser.close();
