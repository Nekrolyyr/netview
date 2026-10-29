// Screenshots of a bundle in each view mode (development aid):
//   node scripts/screenshot.mjs <bundle.netview> <out-dir> [url]
import { chromium } from '@playwright/test';

const [bundle, outDir, url = 'http://localhost:4173'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url);
await page.getByTestId('bundle-input').setInputFiles(bundle);
await page.getByTestId('viewport').waitFor();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outDir}/1-network.png` });
for (const [key, name] of [['2', 'community'], ['3', 'influencer'], ['4', 'sentiment'], ['5', 'radial'], ['6', 'ring'], ['7', 'sphere']]) {
  await page.keyboard.press(key);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${outDir}/${key}-${name}.png` });
}
await page.keyboard.press('1');
await page.waitForTimeout(1200);
const seeker = page.getByTestId('seeker');
const box = await seeker.boundingBox();
await page.mouse.click(box.x + box.width * 0.45, box.y + box.height / 2);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/7-time.png` });
await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
await page.getByTestId('media-list').locator('[role=option]').first().click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/8-media.png` });
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
