import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../fixtures/synthetic.netview', import.meta.url));

test('opens a bundle and drives views, search, time seeker and media filter', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open .netview file' })).toBeVisible();
  await page.getByTestId('bundle-input').setInputFiles(FIXTURE);
  await expect(page.getByTestId('viewport')).toBeVisible();
  await expect(page.getByText(/^137 nodes · \d+ links/)).toBeVisible();
  await page.waitForTimeout(1500);

  // something was drawn (a blank viewport compresses to a few kB)
  const shot = await page.getByTestId('viewport').screenshot();
  expect(shot.byteLength).toBeGreaterThan(30_000);

  // view modes by keyboard
  await page.keyboard.press('2');
  await expect(page.getByRole('tab', { name: 'Community' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('3');
  await expect(page.getByRole('tab', { name: 'Influencer' })).toHaveAttribute('aria-selected', 'true');
  for (const [key, name] of [['4', 'Sentiment'], ['5', 'Radial'], ['6', 'Ring'], ['7', 'Sphere']]) {
    await page.keyboard.press(key);
    await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
    await page.waitForTimeout(1000);                    // the morph to the ordered layout
  }
  await page.keyboard.press('1');
  await page.waitForTimeout(1000);

  // search → node panel
  await page.locator('#node-search').fill('influencer_2');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('details').getByRole('heading', { name: /@influencer_2/ })).toBeVisible();
  await expect(page.getByTestId('details').getByText('Influencer', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  // community panel from the overview list
  await page.getByTestId('details').getByRole('button', { name: /a_user/ }).first().click();
  await expect(page.getByText('Sentiment towards others')).toBeVisible();
  await page.keyboard.press('Escape');

  // time seeker: start = nothing active yet
  const seeker = page.getByTestId('seeker');
  await seeker.focus();
  await page.keyboard.press('Home');
  await expect(page.getByTestId('seeker-date')).toContainText('2025-');
  await expect(page.getByText(/^0 of 137 nodes active/)).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByText(/^137 of 137 nodes active/)).toBeVisible();

  // media filter
  await page.locator('select[aria-label=Sort]').selectOption('reach');
  await page.getByTestId('media-list').getByRole('option').first().click();
  await expect(page.getByText(/Media filter:/)).toBeVisible();
  await expect(page.getByText(/nodes reached/)).toBeVisible();
  await page.getByRole('button', { name: /media selected/ }).click();
  await expect(page.getByText(/Media filter:/)).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('rejects a file that is not a bundle', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('bundle-input').setInputFiles({ name: 'x.netview', mimeType: 'application/octet-stream',
    buffer: Buffer.from('not sqlite at all') });
  await expect(page.getByRole('alert')).toContainText('not a netview bundle');
});
