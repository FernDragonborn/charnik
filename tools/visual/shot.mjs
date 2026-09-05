/*
 * Visual-regression harness. Screenshots key states of every route against the running dev server and
 * pixel-diffs them vs a saved baseline, so a CSS rename / hoist / component split that changes ANY
 * pixel fails loudly instead of being eyeballed.
 *
 *   node tools/visual/shot.mjs --update            # capture / refresh the baseline (run BEFORE changes)
 *   node tools/visual/shot.mjs                      # compare current render vs baseline → exit 1 on drift
 *   node tools/visual/shot.mjs --filter=compendium  # only states whose name contains "compendium"
 *
 * `--filter` is for LOOKING, not for baselining. States share one browser context, so what a state
 * renders can depend on the ones before it (see the combat route). Capture a baseline with a full
 * `--update` run, or the saved image is of a sequence the comparison run never repeats.
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
	'--filter='.length,
);
/** Long enough for a debounced autosave to land — the combat sheet's is 800ms. */
const RESTORE_FLUSH_MS = 1000;
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
				'scroll-behavior:auto!important}',
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
			{ name: 'combat-dice', prep: clickBtn(/Dice tray/), ready: '[role="dialog"]' },
			// the tray PREFILLED from an attack: a test line AND an editable damage line, which is the
			// state UBUG-21 was about — and the only one that shows the two-line model on real data.
			//
			// LAST in this route, and it has to stay last: its prep rolls a real attack, and a prep
			// runs whether or not `ready` then matches — a "skipped" state has already had its effect.
			// Ordering is the only thing keeping that off the next capture, which is the standing
			// weakness of this harness: states share one browser context, so anything a prep writes to
			// storage or to the roll strip is visible to every state after it. A state that fails its
			// `ready` check is the sharp edge, because nothing in the output says it changed anything.
			{
				name: 'combat-dice-attack',
				prep: (p) =>
					p
						.getByText('Greataxe', { exact: true })
						.first()
						.click({ modifiers: ['Shift'] }),
				ready: '.roller-line:nth-of-type(2)',
			},
		],
	},
	{ path: '/', wait: 'main', states: [{ name: 'roster' }] },
	// the builder at rest, then the picker: a grid of options, and the article card that opens beside
	// it over the sheet. Neither state touches the draft — reading an option is not taking it — so
	// nothing here needs a `restore`.
	{
		path: '/build',
		wait: 'main',
		states: [
			{ name: 'build' },
			{
				name: 'build-picker-grid',
				prep: clickText('Choose a class'),
				ready: '[role="option"]',
			},
			{
				name: 'build-picker-card',
				prep: async (p) => {
					await p.getByText('Choose a class', { exact: true }).first().click();
					await p.locator('[role="option"]').first().click();
				},
				// the card is a named REGION, not a dialog: the caret stays in the search box, so it never
				// takes focus and has nothing a dialog's focus contract could be about
				ready: '.picker-card',
			},
		],
	},
	{
		path: '/compendium',
		wait: 'main',
		states: [
			{ name: 'compendium' },
			// interaction: select an entry (covers SpellHead/heads .stat-key/.meta-key/.panel-header)
			{ name: 'compendium-entry', prep: clickText('Fire Bolt'), ready: 'h1:has-text("Fire Bolt")' },
		],
	},
	{ path: '/spellbook', wait: 'main', states: [{ name: 'spellbook' }] },
	{ path: '/settings', wait: 'h1', states: [{ name: 'settings' }] },
	// the source list is on the Content tab, which the base /settings shot never reaches — and `?tab=`
	// makes it a plain URL, so no interaction is needed to get there. Second state expands one pack,
	// the only way the per-file switches are ever seen.
	// the theme cards + the data pane, the two settings tabs with UI of their own and no dev route.
	// The other three (health, collisions, plugins) are deliberately NOT here: on real content they
	// render an all-clear line or a "desktop only" note, and their populated shapes are already
	// covered by /dev/health and /dev/plugins.
	{ path: '/settings?tab=themes', wait: 'h1', states: [{ name: 'settings-themes' }] },
	{ path: '/settings?tab=data', wait: 'h1', states: [{ name: 'settings-data' }] },
	{
		path: '/settings?tab=sources',
		wait: 'h1',
		states: [
			{ name: 'settings-sources' },
			{
				name: 'settings-sources-open',
				prep: (p) => p.getByRole('button', { expanded: false }).first().click(),
				ready: 'text=/\\.csv/',
			},
		],
	},
	{ path: '/translate', wait: '.subbar', states: [{ name: 'translate' }] },
	{ path: '/dev/meta', wait: '[role="dialog"]', states: [{ name: 'dev-meta' }] },
	{ path: '/dev/drift', wait: '[role="dialog"]', states: [{ name: 'dev-drift' }] },
	{ path: '/dev/firstrun', wait: '[role="dialog"]', states: [{ name: 'dev-firstrun' }] },
	{ path: '/dev/plugins', wait: 'h1', states: [{ name: 'dev-plugins' }] },
	// content-health with every problem group populated at once — on real content the panel is always
	// "all clear", so this is the only place its copy and layout are ever seen
	{ path: '/dev/health', wait: '.row', states: [{ name: 'dev-health' }] },
	// the content-pack panel, which is desktop-gated and so only reachable here. Every warning it
	// exists to show is on the fixture at once: rows that would vanish, the drafts they orphan, a
	// pack whose folder name is already taken, and plugin code an update would stop.
	{
		path: '/dev/packs',
		wait: 'h1',
		states: [
			{ name: 'dev-packs' },
			{
				name: 'dev-packs-rename',
				prep: clickBtn(/Rename folder/i),
				ready: 'input[type="text"]',
			},
		],
	},
	// every inspector target at once over one level-8 caster draft — the only place the sectioned
	// spell and equipment pickers, and the panes that scroll as plain content, are all in one frame
	{ path: '/dev/inspector', wait: '.col', states: [{ name: 'dev-inspector', settle: 600 }] },
	{ path: '/dev/deathsaves', wait: 'h1', states: [{ name: 'dev-deathsaves' }] },
	// the roll-card gallery: every shape RollRow has to render (check, attack, crit, volley, nat 1),
	// on one page — the cheapest guard there is on the component four surfaces now share
	{ path: '/dev/rolltoast', wait: 'h1', states: [{ name: 'dev-rolltoast' }] },
	// the dice tray's own gallery. Two states, because the second is the one no static markup can
	// show: the suggestion menu open under a half-typed token, which is where most of the design is.
	{
		path: '/dev/roller',
		wait: 'h1',
		states: [
			{
				name: 'dev-roller',
				prep: (p) => p.locator('.case').nth(2).click(),
				ready: '.roller-line',
			},
			{
				name: 'dev-roller-menu',
				prep: async (p) => {
					await p.locator('.roller-input').first().click();
					await p.keyboard.type('bl');
				},
				ready: '.roller-menu',
			},
		],
	},
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
		reducedMotion: 'reduce',
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
			// play.inCombat, which autosaves) so it can't bleed into the next state or the next run.
			//
			// The wait is the whole point: the save it undoes is DEBOUNCED, so a `goto` fired straight
			// after the restoring click cancels it and leaves the mutation on disk. That failure is
			// invisible in isolation — the state after it drifts, passes when run alone with --filter,
			// and drifts again in a full run.
			if (st.restore) {
				await st.restore(page).catch(() => {});
				await page.waitForTimeout(RESTORE_FLUSH_MS);
			}
		}
	}
	await browser.close();
	if (UPDATE) {
		console.log(`\nbaseline updated (${captured} states).`);
		return;
	}
	if (drifted.length) {
		console.log(
			`\nVISUAL DRIFT in ${drifted.length}/${captured} states — see ${CURRENT}/*.diff.png:`,
		);
		for (const d of drifted) console.log(`  ✗ ${d.name}: ${d.px} px`);
		process.exit(1);
	}
	console.log(`\nno visual drift (${captured} states).`);
}
run();
