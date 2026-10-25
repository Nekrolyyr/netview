import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://localhost:4174' });

test('opens the default bundle on start', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  await expect(page.getByTestId('viewport')).toBeVisible();
  await expect(page.getByText(/^137 nodes · \d+ links/)).toBeVisible();
  expect(errors).toEqual([]);
});
