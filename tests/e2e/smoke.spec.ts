import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Smoke suite for the Mesvee shell.
 *
 * Every spec starts from a first-run profile (onboarding, zero services) so the
 * flows stay deterministic regardless of what earlier runs persisted in the mock
 * bridge. Copy assertions use the default locale, Bahasa Indonesia.
 */

/** Storage key owned by `src/core/bridge/mock.ts`. */
const STORAGE_KEY = 'mesvee.mock.settings.v1';

/** Seeds a first-run profile: not onboarded, no accounts, no PIN. */
async function startFresh(page: Page): Promise<void> {
  await page.addInitScript(
    ([key]) => {
      window.localStorage.setItem(key, JSON.stringify({ onboarded: false, services: [] }));
    },
    [STORAGE_KEY],
  );
  await page.goto('/');
}

/** Selectors for the add-service dialog (a shared Modal with a search box). */
function addServiceDialog(page: Page) {
  return page.getByRole('dialog').filter({ has: page.getByPlaceholder('Cari layanan', { exact: true }) });
}

/**
 * Walks the three onboarding steps and asserts the workspace shell appears.
 *
 * Onboarding finishes by opening the add-service dialog for the first account,
 * so the helper dismisses it to leave every spec on a clean workspace. Specs
 * that need the dialog reopen it from the rail.
 */
async function finishOnboarding(page: Page): Promise<void> {
  await expect(page.getByText('Langkah 1 dari 3')).toBeVisible();
  await page.getByRole('button', { name: 'Mulai', exact: true }).click();
  await expect(page.getByText('Langkah 2 dari 3')).toBeVisible();
  await page.getByRole('button', { name: 'Lanjutkan', exact: true }).click();
  await expect(page.getByText('Langkah 3 dari 3')).toBeVisible();
  await page.getByRole('button', { name: 'Masuk ke Mesvee' }).click();
  await expect(page.getByRole('navigation', { name: 'Layanan Anda' })).toBeVisible();

  const dialog = addServiceDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Batal', exact: true }).click();
  await expect(dialog).toBeHidden();
}

/**
 * WCAG contrast ratio between an element's text colour and the background it
 * paints itself. Guards the CSS layering regression where a global `button`
 * reset overrode `text-accent-ink` and produced white-on-white labels.
 */
async function selfContrast(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const channels = (value: string) => (value.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number);
    const luminance = (rgb: number[]) => {
      const [r, g, b] = rgb.map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const style = getComputedStyle(element);
    const foreground = luminance(channels(style.color));
    const background = luminance(channels(style.backgroundColor));
    const [light, dark] = [foreground, background].sort((a, b) => b - a);
    return (light + 0.05) / (dark + 0.05);
  });
}

/** Opens a route from the settings side navigation inside the main region. */
async function openSettingsSection(page: Page, section: string): Promise<void> {
  const rail = page.getByRole('navigation', { name: 'Layanan Anda' });
  const main = page.getByRole('main');
  await rail.getByRole('button', { name: 'Pengaturan', exact: true }).click();
  await main.getByRole('button', { name: section, exact: true }).click();
}

test.describe('onboarding', () => {
  test('greets a new user and lands them in the workspace', async ({ page }) => {
    await startFresh(page);

    await expect(page.getByText('Satu ruang untuk semuanya')).toBeVisible();
    await finishOnboarding(page);

    // The empty workspace invites the first account.
    await expect(page.getByRole('main')).toContainText('Tambah layanan');
  });
});

test.describe('command palette', () => {
  test('opens with a shortcut and jumps to settings', async ({ page }) => {
    await startFresh(page);
    await finishOnboarding(page);

    await page.getByRole('button', { name: /Cari layanan atau aksi/ }).click();
    const search = page.locator('input[aria-label="Pencarian command palette"]');
    await expect(search).toBeFocused();

    await search.fill('pengaturan');
    // Each settings section is its own row: "Buka pengaturan — Umum", …
    await page.getByRole('button', { name: /^Buka pengaturan/ }).first().click();

    await expect(page.getByRole('button', { name: 'Kembali ke aplikasi' })).toBeVisible();
  });
});

test.describe('settings', () => {
  test('switches theme and language live', async ({ page }) => {
    await startFresh(page);
    await finishOnboarding(page);
    await openSettingsSection(page, 'Tampilan');

    // Theme resolves onto <html data-theme> before any paint.
    await page.getByRole('main').getByRole('button', { name: 'Terang', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // Language switches at runtime — no reload, no flash. It is a radio group.
    await page.getByRole('main').getByRole('radio', { name: 'EN', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: 'Back to app' })).toBeVisible();
  });
});

test.describe('services', () => {
  test('adds an account from the catalog', async ({ page }) => {
    await startFresh(page);
    await finishOnboarding(page);

    await page.getByRole('navigation', { name: 'Layanan Anda' }).getByRole('button', { name: 'Tambah layanan', exact: true }).click();
    await expect(page.getByText('Pilih layanan lalu beri nama akun agar mudah dibedakan.')).toBeVisible();

    await page.getByPlaceholder('Cari layanan', { exact: true }).fill('Telegram');
    await page.getByRole('button', { name: /Telegram/ }).first().click();
    await page.getByRole('button', { name: 'Tambahkan layanan', exact: true }).click();

    // The account is now pinned to the rail.
    const rail = page.getByRole('navigation', { name: 'Layanan Anda' });
    await expect(rail.getByRole('button', { name: /Telegram/ })).toBeVisible();
  });

  test('keeps primary actions legible', async ({ page }) => {
    await startFresh(page);
    await finishOnboarding(page);

    // The hero CTA is white-on-dark-text; a broken reset silently erases the label.
    const cta = page.getByRole('main').getByRole('button', { name: 'Tambah layanan' }).first();
    expect(await selfContrast(cta)).toBeGreaterThan(7);

    // Active accounts invert to solid ink, so their brand glyph must invert too.
    await page
      .getByRole('navigation', { name: 'Layanan Anda' })
      .getByRole('button', { name: 'Tambah layanan', exact: true })
      .click();
    await page.getByPlaceholder('Cari layanan', { exact: true }).fill('Telegram');
    await page.getByRole('button', { name: /Telegram/ }).first().click();
    await page.getByRole('button', { name: 'Tambahkan layanan', exact: true }).click();

    const active = page
      .getByRole('navigation', { name: 'Layanan Anda' })
      .locator('button[aria-current="page"]')
      .first();
    await expect(active).toBeVisible();
    expect(await selfContrast(active)).toBeGreaterThan(7);

    // The action tray expands the toolbar instead of covering (and hiding) the
    // webview, and it always closes again.
    await page.getByRole('button', { name: 'Aksi lainnya' }).click();
    const tray = page.getByRole('toolbar', { name: 'Aksi lainnya' });
    await expect(tray).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tray).toBeHidden();

    await page.getByRole('button', { name: 'Aksi lainnya' }).click();
    await expect(tray).toBeVisible();
    await page.mouse.click(720, 640);
    await expect(tray).toBeHidden();
  });
});

test.describe('app lock', () => {
  test('enables a PIN, locks the workspace and unlocks again', async ({ page }) => {
    await startFresh(page);
    await finishOnboarding(page);

    // No PIN yet: the rail offers to enable the lock and jumps to Keamanan.
    const rail = page.getByRole('navigation', { name: 'Layanan Anda' });
    await rail.getByRole('button', { name: 'Aktifkan kunci', exact: true }).click();
    await expect(page.getByRole('main').getByText('Kunci aplikasi nonaktif')).toBeVisible();

    await page.getByRole('main').getByRole('button', { name: 'Aktifkan kunci', exact: true }).click();
    await page.getByPlaceholder('PIN baru', { exact: true }).fill('123456');
    await page.getByPlaceholder('Ulangi PIN baru').fill('123456');
    await page.getByRole('button', { name: 'Simpan', exact: true }).click();

    // The one-time recovery code must be acknowledged before the shell returns.
    await expect(page.getByText('Simpan kode pemulihan')).toBeVisible();
    await page.getByRole('button', { name: 'Saya sudah menyimpannya', exact: true }).click();
    await expect(page.getByRole('main').getByText('Kunci aplikasi aktif')).toBeVisible();

    // Lock from the rail, then unlock with the keypad.
    await rail.getByRole('button', { name: 'Kunci aplikasi', exact: true }).click();
    await expect(page.getByText('Mesvee terkunci')).toBeVisible();

    for (const digit of ['1', '2', '3', '4', '5', '6']) {
      await page.getByRole('button', { name: digit, exact: true }).click();
    }
    await page.getByRole('button', { name: 'Buka', exact: true }).click();

    await expect(page.getByRole('navigation', { name: 'Layanan Anda' })).toBeVisible();
  });
});