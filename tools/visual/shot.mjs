/*
 * Visual-regression harness. Screenshots key states of every route against the running dev server and
 * pixel-diffs them vs a saved baseline, so a CSS rename / hoist / component split that changes ANY
 * pixel fails loudly instead of being eyeballed.
 *
 *   node tools/visual/shot.mjs --update            # capture / refresh the baseline (run BEFORE changes)
 *   node tools/visual/shot.mjs                      # compare current render vs baseline → exit 1 on drift
 *   node tools/visual/shot.mjs --filter=compendium  # only states whose name contains "compendium"
 *
 * BASE env overrides the URL (default http://localhost:5173 — the dev server is often on a different
 * port, read `pnpm dev`'s output and pass BASE=http://localhost:PORT).
 *
 * States come in two kinds: plain landing states (just load the route) and INTERACTION states that
 * open a menu / dialog / entry via a `prep` fn. An interaction state declares a `ready` selector that
 * must appear AFTER prep — if it doesn't, the state is skipped with a loud warning instead of
 * silently capturing the wrong screen (which would poison the baseline). Add a state by following the
 * pattern below; keep prep locators robust (`.first()`, role/text queries).
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5173';
const UPDATE = process.argv.includes('--update');
const FILTER = (process.argv.find((a) => a.startsWith('--filter=')) ?? '').slice(
	'--filter='.length
);
const DIR = 'tools/visual';
const BASELINE = `${DIR}/baseline`;
const CURRENT = `${DIR}/current`;
mkdirSync(BASELINE, { recursive: true });
mkdirSync(CURRENT, { recursive: true });

// --- reusable prep/locator helpers (robust: role/text queries, always `.first()`) -----------------
const press = (keys) => (p) => p.keyboard.press(keys);
const clickBtn = (re) => (p) => p.getByRole('button', { name: re }).first().click();
const clickText = (t) => (p) => p.getByText(t, { exact: true }).first().click();
const esc = (p) => p.keyboard.press('Escape');

/** Neutralize animations/transitions/caret so a screenshot is deterministic (no mid-transition or
 *  blinking-caret 1px flake). Re-applied after every navigation because a goto reloads the document. */
async function freeze(page) {
	await page
		.addStyleTag({
			content:
				'*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;' +
				'transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important;' +
				'scroll-behavior:auto!important}'
		})
		.catch(() => {});
}

/**
 * Routes to capture. Each: a `path`, a `wait` selector for initial load, and `states`.
 * A state: { name, prep?, ready?, restore?, settle? }
 *   prep    — async fn(page) to reach an interaction state (open a menu / select an entry)
 *   ready   — selector that must appear after prep (self-validates the state was reached)
 *   restore — async fn(page) to return to the route's base state before the next state
 *   settle  — extra ms to wait before the shot (rarely needed once animations are frozen)
 */
const ROUTES = [
	{
		path: '/combat',
		wait: 'h1',
		states: [
			{ name: 'combat-default' },
			// interaction: a CombatMenus popup (covers the .popup-h / .section eyebrow labels)
			{ name: 'combat-temphp', prep: clickBtn(/Temp HP/), ready: 'text=Set temporary HP' },
			// interaction: the Ctrl+K command palette (covers CommandPalette .group)
			{ name: 'command-palette', prep: press('Control+k'), ready: '[role="dialog"]' },
			{ name: 'combat-turnbar', prep: clickBtn(/Combat/), restore: clickBtn(/Combat/) },
			{ name: 'combat-dice', prep: clickBtn(/Dice tray/), ready: '[role="dialog"]' }
		]
	},
	{ path: '/', wait: 'main', states: [{ name: 'roster' }] },
	{ path: '/build', wait: 'main', states: [{ name: 'build' }] },
	{
		path: '/compendium',
		wait: 'main',
		states: [
			{ name: 'compendium' },
			// interaction: select an entry (covers SpellHead/heads .stat-key/.meta-key/.panel-header)
			{ name: 'compendium-entry', prep: clickText('Fire Bolt'), ready: 'h1:has-text("Fire Bolt")' }
		]
	},
	{ path: '/spellbook', wait: 'main', states: [{ name: 'spellbook' }] },
	{ path: '/settings', wait: 'h1', states: [{ name: 'settings' }] },
	{ path: '/translate', wait: '.subbar', states: [{ name: 'translate' }] },
	{ path: '/dev/meta', wait: '[role="dialog"]', states: [{ name: 'dev-meta' }] },
	{ path: '/dev/drift', wait: '[role="dialog"]', states: [{ name: 'dev-drift' }] },
	{ path: '/dev/firstrun', wait: '[role="dialog"]', states: [{ name: 'dev-firstrun' }] },
	{ path: '/dev/plugins', wait: 'h1', states: [{ name: 'dev-plugins' }] },
	{ path: '/dev/deathsaves', wait: 'h1', states: [{ name: 'dev-deathsaves' }] }
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
	const page = await browser.newPage({
		viewport: { width: 1280, height: 1400 },
		reducedMotion: 'reduce'
	});
	const drifted = []; // { name, px } for every state that changed — a summary beats a lone `worst`
	let captured = 0;
	// One fresh page load PER state, so an interaction (an open menu, a toggled combat mode) can never
	// leak into the next state's capture. A few extra reloads buy full isolation — worth it for a
	// baseline that must be stable to the pixel.
	for (const route of ROUTES) {
		for (const st of route.states) {
			if (FILTER && !st.name.includes(FILTER)) continue;
			try {
				await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle' });
				await page.waitForSelector(route.wait, { timeout: 15000 });
			} catch {
				console.log(`! ${st.name}: route ${route.path} did not load (skipped)`);
				continue;
			}
			await freeze(page);
			if (st.prep) {
				try {
					await st.prep(page);
					if (st.ready) await page.waitForSelector(st.ready, { timeout: 5000 });
				} catch {
					// prep/ready failed → the state wasn't reached; skip rather than capture the wrong screen
					console.log(`! ${st.name}: prep did not reach the state (skipped)`);
					continue;
				}
			}
			await page.waitForTimeout(st.settle ?? 120);
			const buf = await page.screenshot({ fullPage: true });
			writeFileSync(`${UPDATE ? BASELINE : CURRENT}/${st.name}.png`, buf);
			captured++;
			if (UPDATE) console.log(`· ${st.name}: baseline saved`);
			else {
				const px = compare(st.name, buf);
				if (px > 0) drifted.push({ name: st.name, px });
			}
			// `restore` reverts a state that mutated PERSISTENT data (e.g. combat-turnbar toggles
			// play.inCombat, which autosaves) so it can't bleed into the next run's baseline.
			if (st.restore) await st.restore(page).catch(() => {});
		}
	}
	await browser.close();
	if (UPDATE) {
		console.log(`\nbaseline updated (${captured} states).`);
		return;
	}
	if (drifted.length) {
		console.log(
			`\nVISUAL DRIFT in ${drifted.length}/${captured} states — see ${CURRENT}/*.diff.png:`
		);
		for (const d of drifted) console.log(`  ✗ ${d.name}: ${d.px} px`);
		process.exit(1);
	}
	console.log(`\nno visual drift (${captured} states).`);
}
run();
