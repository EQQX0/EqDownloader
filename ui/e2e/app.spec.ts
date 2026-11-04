import { expect, test, type Page } from '@playwright/test';

const tid = (page: Page, id: string) => page.getByTestId(id);

test('paste a link, download with Best, see it Done and in Library', async ({ page }) => {
  await page.goto('/');
  await tid(page, 'link-input').fill('Check this https://example.test/v please');
  await tid(page, 'link-submit').click();

  await expect(tid(page, 'probe-title')).toHaveText('Fake video');
  for (const id of ['preset-best', 'preset-1080p', 'preset-720p', 'preset-mp3', 'preset-m4a']) {
    await expect(tid(page, id)).toBeVisible();
  }
  await tid(page, 'preset-best').click();
  await tid(page, 'start-button').click();

  await expect(tid(page, 'nav-downloads')).toHaveAttribute('aria-current', 'page');
  const state = tid(page, 'item-state');
  await expect(state).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain('NaN');
  await expect(state).toHaveText('Done', { timeout: 10_000 });
  expect(await page.locator('body').innerText()).not.toContain('NaN');

  await tid(page, 'nav-library').click();
  await expect(page.getByText('Fake video').first()).toBeVisible();
  await expect(tid(page, 'item-state')).toHaveText('Done');
  await expect(tid(page, 'item-open')).toBeHidden();
});

test('text without a link shows No link found.', async ({ page }) => {
  await page.goto('/');
  await tid(page, 'link-input').fill('hello');
  await tid(page, 'link-submit').click();
  await expect(tid(page, 'error-message')).toHaveText('No link found.');
});

test('settings show the destination and engine update', async ({ page }) => {
  await page.goto('/');
  await tid(page, 'nav-settings').click();
  await expect(tid(page, 'destination')).toHaveText('Downloads');
  await tid(page, 'update-engine').click();
  await expect(tid(page, 'engine-version')).toHaveText('fake-1.0.0');
  await expect(tid(page, 'choose-folder')).toBeHidden();
});

/** Installs a scripted window.eq so the real UI can be driven through error paths. */
async function installStubEngine(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const handlers = new Set<(i: unknown) => void>();
    let n = 0;
    const items = new Map<string, Record<string, unknown>>();
    const emit = (id: string, patch: Record<string, unknown>) => {
      const next = { ...items.get(id), ...patch };
      items.set(id, next);
      handlers.forEach((h) => h({ ...next }));
    };
    (window as unknown as { eq: unknown }).eq = {
      async probe(url: string) {
        if (url.includes('unsupported')) throw { code: 'unsupported', message: 'x' };
        if (url.includes('outdated')) throw { code: 'outdated', message: 'x' };
        if (url.includes('long')) {
          const title = 'A very long video title that keeps going well past what two lines can hold on a narrow phone screen, and then some more words';
          return { url, title, thumbnail: null, durationSec: 5, formats: [] };
        }
        return { url, title: 'Stub video', thumbnail: null, durationSec: 5, formats: [] };
      },
      async start(url: string, preset: string) {
        const id = `s-${++n}`;
        items.set(id, { id, url, title: url, preset, state: 'queued', percent: 0, speedBps: null, etaSec: null, filePath: null, error: null });
        setTimeout(() => {
          if (n === 1) emit(id, { state: 'failed', error: { code: 'network', message: 'dns' } });
          else emit(id, { state: 'done', percent: 100, filePath: 'C:/x/Stub video.mp4' });
        }, 100);
        return id;
      },
      async cancel() {},
      async list() { return []; },
      async updateEngine() { return '2099.01.01'; },
      onProgress(h: (i: unknown) => void) { handlers.add(h); return () => handlers.delete(h); },
      async getDefaultFolder() { return 'C:/Users/me/Downloads'; },
      async chooseFolder() { return null; },
      async revealFile() {},
    };
  });
}

test('network failure shows Failed with Retry, and Retry creates a new item', async ({ page }) => {
  await installStubEngine(page);
  await page.goto('/');
  await tid(page, 'link-input').fill('https://example.test/v');
  await tid(page, 'link-submit').click();
  await tid(page, 'start-button').click();

  await expect(tid(page, 'item-state')).toHaveText('Failed');
  await expect(tid(page, 'item-error')).toHaveText('No network connection.');
  await expect(tid(page, 'item-retry')).toBeVisible();
  await tid(page, 'item-retry').click();

  await expect(page.locator('[data-testid^="item-s-"]')).toHaveCount(2);
  await expect(page.getByTestId('item-s-2').getByTestId('item-state')).toHaveText('Done');
  await expect(page.getByTestId('item-s-1').getByTestId('item-state')).toHaveText('Failed');
  await tid(page, 'nav-library').click();
  await expect(tid(page, 'item-open')).toBeVisible();
  await expect(page.getByText('Stub video', { exact: true })).toBeVisible();
});

for (const [kind, message] of [
  ['unsupported', 'This site is not supported.'],
  ['outdated', 'The download engine is out of date.'],
] as const) {
  test(`${kind} link shows the message and an Update engine action`, async ({ page }) => {
    await installStubEngine(page);
    await page.goto('/');
    await tid(page, 'link-input').fill(`https://example.test/${kind}`);
    await tid(page, 'link-submit').click();
    await expect(tid(page, 'error-message')).toHaveText(message);
    await expect(tid(page, 'update-engine')).toHaveCount(1);
    await tid(page, 'update-engine').click();
    await expect(tid(page, 'error-message')).toBeHidden();
    await tid(page, 'nav-settings').click();
    await expect(tid(page, 'engine-version')).toHaveText('2099.01.01');
    await expect(tid(page, 'update-engine')).toHaveCount(1);
  });
}

test('a title cut at two lines can be opened by keyboard and tap', async ({ page }) => {
  await installStubEngine(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await tid(page, 'link-input').fill('https://example.test/long');
  await tid(page, 'link-submit').click();
  const toggle = tid(page, 'probe-title').getByRole('button');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('a short title stays plain text', async ({ page }) => {
  await installStubEngine(page);
  await page.goto('/');
  await tid(page, 'link-input').fill('https://example.test/v');
  await tid(page, 'link-submit').click();
  await expect(tid(page, 'probe-title')).toHaveText('Stub video');
  await page.waitForTimeout(300); // let the clamp measure run
  await expect(tid(page, 'probe-title').getByRole('button')).toHaveCount(0);
});

test('desktop bridge supplies the default destination and Show in folder', async ({ page }) => {
  await installStubEngine(page);
  await page.goto('/');
  await tid(page, 'nav-settings').click();
  await expect(tid(page, 'destination')).toHaveText('C:/Users/me/Downloads');
  await expect(tid(page, 'choose-folder')).toBeVisible();
});
