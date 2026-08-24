/*
 * One-off: photograph the roller organ's preview states so the design can be LOOKED at rather than
 * reasoned about. Not part of the regression harness (shot.mjs owns that) — this walks the /dev/roller
 * preset list and drops a PNG per case into design-preview/.
 *
 *   node tools/visual/roller-shots.mjs            # dark
 *   THEME=light node tools/visual/roller-shots.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5199';
const THEME = process.env.THEME || 'dark';
const OUT = 'design-preview';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
await page.goto(`${BASE}/dev/roller`, { waitUntil: 'networkidle' });
await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), THEME);
await page.addStyleTag({ content: '*{caret-color:transparent!important}' });

const cases = await page.locator('.case').allTextContents();
for (const [i, title] of cases.entries()) {
	await page.locator('.case').nth(i).click();
	await page.waitForTimeout(80);
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.slice(0, 40)
		.replace(/^-|-$/g, '');
	await page.locator('.page').screenshot({ path: `${OUT}/roller-${THEME}-${i}-${slug}.png` });
	console.log(`roller-${THEME}-${i}-${slug}.png`);
}

// the live states the presets can't reach: the suggestion menu mid-type, and a completed roll
await page.locator('.case').nth(2).click();
await page.locator('.roller-input').first().click();
await page.keyboard.type('bl');
await page.waitForTimeout(120);
await page.locator('.page').screenshot({ path: `${OUT}/roller-${THEME}-menu.png` });
console.log(`roller-${THEME}-menu.png`);

await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Roll', exact: true }).click();
await page.waitForTimeout(150);
await page.locator('.page').screenshot({ path: `${OUT}/roller-${THEME}-rolled.png` });
console.log(`roller-${THEME}-rolled.png`);

await browser.close();
