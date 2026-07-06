/*
 * Visual-regression harness for the combat-page CSS refactor. Screenshots a few states of a live
 * route (against the running dev server) and pixel-diffs them against a saved baseline, so a CSS
 * rename / component split that changes ANY pixel fails loudly instead of being eyeballed.
 *
 *   node tools/visual/shot.mjs --update    # capture / refresh the baseline (run BEFORE changes)
 *   node tools/visual/shot.mjs             # compare current render vs baseline → nonzero exit on drift
 *
 * BASE env overrides the URL (default http://localhost:5173).
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5173';
const UPDATE = process.argv.includes('--update');
const DIR = 'tools/visual';
const BASELINE = `${DIR}/baseline`;
const CURRENT = `${DIR}/current`;
mkdirSync(BASELINE, { recursive: true });
mkdirSync(CURRENT, { recursive: true });

/** The states to capture. Each: navigate, optionally interact, screenshot, then restore. */
const STATES = [
	{ name: 'combat-default', prep: async () => {} },
	{
		name: 'combat-turnbar',
		prep: async (page) => {
			await page.getByRole('button', { name: /Combat/ }).first().click();
			await page.waitForTimeout(150);
		},
		restore: async (page) => {
			await page.getByRole('button', { name: /Combat/ }).first().click();
		}
	},
	{
		name: 'combat-dice',
		prep: async (page) => {
			await page.getByRole('button', { name: /Dice tray/ }).click();
			await page.waitForTimeout(150);
		},
		restore: async (page) => page.keyboard.press('Escape')
	}
];

async function run() {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
	await page.goto(`${BASE}/combat`, { waitUntil: 'networkidle' });
	await page.waitForSelector('h1', { timeout: 15000 }); // the character name = sheet rendered

	let worst = 0;
	for (const st of STATES) {
		await st.prep(page);
		const buf = await page.screenshot({ fullPage: true });
		const outDir = UPDATE ? BASELINE : CURRENT;
		writeFileSync(`${outDir}/${st.name}.png`, buf);
		if (!UPDATE) {
			const basePath = `${BASELINE}/${st.name}.png`;
			if (!existsSync(basePath)) {
				console.log(`? ${st.name}: no baseline (run --update first)`);
			} else {
				const a = PNG.sync.read(readFileSync(basePath));
				const b = PNG.sync.read(buf);
				if (a.width !== b.width || a.height !== b.height) {
					console.log(`✗ ${st.name}: size changed ${a.width}x${a.height} → ${b.width}x${b.height}`);
					worst = Math.max(worst, 999999);
				} else {
					const diff = new PNG({ width: a.width, height: a.height });
					const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
					writeFileSync(`${CURRENT}/${st.name}.diff.png`, PNG.sync.write(diff));
					worst = Math.max(worst, n);
					console.log(`${n === 0 ? '✓' : '✗'} ${st.name}: ${n} px differ`);
				}
			}
		} else {
			console.log(`· ${st.name}: baseline saved`);
		}
		if (st.restore) await st.restore(page).catch(() => {});
	}
	await browser.close();
	if (!UPDATE && worst > 0) {
		console.log(`\nVISUAL DRIFT: ${worst} px — see tools/visual/current/*.diff.png`);
		process.exit(1);
	}
	console.log(UPDATE ? '\nbaseline updated.' : '\nno visual drift.');
}
run();
