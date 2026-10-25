import { expect, test } from '@playwright/test';

/** The second preview server serves tests/fixtures/synthetic.netview and tests/fixtures/media/. */
test.use({ baseURL: 'http://localhost:4174' });

test('opens the default bundle on start and shows its media', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  await expect(page.getByTestId('viewport')).toBeVisible();
  await expect(page.getByText(/^137 nodes · \d+ links/)).toBeVisible();

  // posts without an embedded thumbnail use the downloaded image
  const list = page.getByTestId('media-list');
  await expect(list.locator('img')).toHaveCount(2);

  // carousel: three images, arrow keys step through them
  await list.getByTitle('View the post (3 items)').click();
  const viewer = page.getByTestId('media-viewer');
  await expect(viewer).toBeVisible();
  const image = viewer.locator('img');
  await expect(image).toHaveAttribute('src', 'data/media/M02_1.jpg');
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(480);
  await page.keyboard.press('ArrowRight');
  await expect(image).toHaveAttribute('src', 'data/media/M02_2.jpg');
  await expect(viewer.getByText(/2\/3/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();

  // video
  const videoButton = list.getByRole('button', { name: '▶' });
  await videoButton.click();
  const video = viewer.locator('video');
  await expect(video).toHaveAttribute('src', 'data/media/M00_0.mp4');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
  await viewer.getByTitle('Close (Esc)').click();
  await expect(viewer).toBeHidden();

  expect(errors).toEqual([]);
});
