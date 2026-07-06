/*
 * Visual-regression harness for the CSS refactor. Screenshots key states of several routes against
 * the running dev server and pixel-diffs them vs a saved baseline, so a CSS rename / hoist / component
 * split that changes ANY pixel fails loudly instead of being eyeballed.
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

const clickCombat = (page) =>
	page
		.getByRole('button', { name: /Combat/ })
		.first()
		.click();

/** Routes to capture. Each: a path, a selector to await, and optional extra interactive states. */
const ROUTES = [
	{
		path: '/combat',
		wait: 'h1',
		states: [
			{ name: 'combat-default' },
			{ name: 'combat-turnbar', prep: clickCombat, restore: clickCombat },
			{
				name: 'combat-dice',
				prep: (p) => p.getByRole('button', { name: /Dice tray/ }).click(),
				restore: (p) => p.keyboard.press('Escape')
			}
		]
	},
	{ path: '/', wait: 'main', states: [{ name: 'roster' }] },
	{ path: '/build', wait: 'main', states: [{ name: 'build' }] },
	{ path: '/compendium', wait: 'main', states: [{ name: 'compendium' }] },
	{ path: '/dev/meta', wait: '[role="dialog"]', states: [{ name: 'dev-meta' }] },
	{ path: '/dev/drift', wait: '[role="dialog"]', states: [{ name: 'dev-drift' }] }
];

function compare(name, buf) {
	const basePath = `${BASELINE}/${name}.png`;
	if (!existsSync(basePath)) {
		console.log(`? ${name}: no baseline (run --update first)`);
		return 0;
	}
	const a = PNG.sync.read(readFileSync(basePath));
	const b = PNG.sync.read(buf);
	if (a.width !== b.width || a.height !== b.height) {
		console.log(`✗ ${name}: size changed ${a.width}x${a.height} → ${b.width}x${b.height}`);
		return 999999;
	}
	const diff = new PNG({ width: a.width, height: a.height });
	const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
	writeFileSync(`${CURRENT}/${name}.diff.png`, PNG.sync.write(diff));
	console.log(`${n === 0 ? '✓' : '✗'} ${name}: ${n} px differ`);
	return n;
}

async function run() {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
	let worst = 0;
	for (const route of ROUTES) {
		try {
			await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle' });
			await page.waitForSelector(route.wait, { timeout: 15000 });
		} catch {
			console.log(`! ${route.path}: did not load (skipped)`);
			continue;
		}
		for (const st of route.states) {
			if (st.prep) await st.prep(page).catch(() => {});
			await page.waitForTimeout(150);
			const buf = await page.screenshot({ fullPage: true });
			writeFileSync(`${UPDATE ? BASELINE : CURRENT}/${st.name}.png`, buf);
			if (UPDATE) console.log(`· ${st.name}: baseline saved`);
			else worst = Math.max(worst, compare(st.name, buf));
			if (st.restore) await st.restore(page).catch(() => {});
		}
	}
	await browser.close();
	if (!UPDATE && worst > 0) {
		console.log(`\nVISUAL DRIFT: ${worst} px — see tools/visual/current/*.diff.png`);
		process.exit(1);
	}
	console.log(UPDATE ? '\nbaseline updated.' : '\nno visual drift.');
}
run();
