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
