/*
 * Overflow probe for the mouse and touch layouts. It asserts the two things that make a narrow
 * layout usable:
 *
 *   1. `document.scrollWidth` equals the viewport. Horizontal overflow at the DOCUMENT level scrolls
 *      the whole page sideways and drags every `position: fixed` overlay off-side with it.
 *   2. Nothing inside `main` is wider than `main`, unless an ancestor scrolls it on purpose
 *      (`overflow-x: auto | scroll | hidden` — a tab strip or a combat bar that scrolls is fine).
 *
 *   node tools/visual/narrow.mjs                       # every route at all play widths
 *   node tools/visual/narrow.mjs --locale=uk           # same, in Ukrainian (labels run ~15px wider)
 *   node tools/visual/narrow.mjs --width=740 --height=360   # one size, e.g. landscape
 *
 * BASE env overrides the URL (default http://localhost:5173 — `pnpm dev` is often on another port,
 * read its output and pass BASE=http://localhost:PORT).
 *
 * It reports the DEEPEST offender it can name, so the line points at the box with the floor rather
 * than at every ancestor that inherited it.
 *
 * It also prints an ADVISORY tap-target census — a control a 24×24 finger square does not reliably
 * hit. Advisory because what is left of it is a spacing question, not a defect (see
 * `findSmallTargets`), and it never fails the run.
 */
import { chromium } from 'playwright';
import { dismissMobileWarning, PLAY_VIEWPORTS, viewportOptions } from './play-viewports.mjs';

const BASE = process.env.BASE || 'http://localhost:5173';
const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? '').split('=')[1];
const LOCALE = arg('locale');
const THEME = arg('theme') ?? 'dark';
const WIDTH = Number(arg('width'));
const PROFILES = arg('width')
	? [PLAY_VIEWPORTS.find(({ width }) => width === WIDTH) ?? { width: WIDTH, touch: true }]
	: PLAY_VIEWPORTS;
const HEIGHT = Number(arg('height') ?? 800);

const ROUTES = [
	'/',
	'/build',
	'/combat',
	'/spellbook',
	'/compendium',
	'/compendium/spell/fireball',
	'/settings?tab=general',
	'/settings?tab=themes',
	'/settings?tab=data',
	'/settings?tab=health',
	'/settings?tab=sources',
	'/settings?tab=collisions',
	'/settings?tab=plugins',
	'/translate',
	'/dev',
];

// runs in the page: every element inside `main` whose box escapes main's, minus the ones an ancestor
// scrolls deliberately and the ones that only inherited a child's floor
const findOverflow = () => {
	const main = document.querySelector('main');
	const viewport = document.documentElement.clientWidth;
	const documentWidth = document.documentElement.scrollWidth;
	// no <main> is not "nothing overflowed" — it is a route that did not render, and reporting that as
	// a pass is how this probe once cleared /combat while measuring nothing at all.
	if (!main) return { viewport, documentWidth, offenders: [], noMain: true };
	const bounds = main.getBoundingClientRect();
	const escapes = (el) => {
		const box = el.getBoundingClientRect();
		return (
			box.width > 0 &&
			box.height > 0 &&
			(box.right > bounds.right + 1 || box.left < bounds.left - 1)
		);
	};
	const scrolledByAncestor = (el) => {
		for (let p = el.parentElement; p && p !== main; p = p.parentElement) {
			const overflowX = getComputedStyle(p).overflowX;
			if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden') return true;
		}
		return false;
	};
	const offenders = [];
	for (const el of main.querySelectorAll('*')) {
		if (!escapes(el) || scrolledByAncestor(el)) continue;
		if (Array.from(el.children).some(escapes)) continue; // an ancestor of the real offender
		const box = el.getBoundingClientRect();
		const name = `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ')[0]}` : ''}`;
		offenders.push(
			`${name} w=${Math.round(box.width)} over=${Math.round(box.right - bounds.right)} "${(el.textContent || '').trim().slice(0, 28)}"`,
		);
	}
	return { viewport, documentWidth, mainScrollWidth: main.scrollWidth, offenders };
};

// Runs in the page. Reports a control a finger cannot reliably hit — measured by HIT TESTING a 24×24
// square centred on it, not by reading its box: most of the small ones here already carry an
// invisible `::before` expander, and a box-size census calls those broken when they are not.
// Advisory, never a failure: what is left is a spacing question (a pip 4px from its neighbour cannot
// grow without stealing its neighbour's taps) and that is answered with a phone in a hand.
const findSmallTargets = () => {
	const MIN = 24;
	const reach = MIN / 2 - 1;
	const offsets = [
		[-reach, -reach],
		[reach, -reach],
		[-reach, reach],
		[reach, reach],
		[0, -reach],
		[0, reach],
		[-reach, 0],
		[reach, 0],
	];
	const small = {};
	for (const el of document.querySelectorAll(
		'a, button, input, select, summary, [role="button"]',
	)) {
		// elementFromPoint answers null outside the viewport, so bring the control into it first
		el.scrollIntoView({ block: 'center' });
		const box = el.getBoundingClientRect();
		if (box.width === 0 || box.height === 0) continue;
		if (box.width >= MIN && box.height >= MIN) continue;
		const cx = box.left + box.width / 2;
		const cy = box.top + box.height / 2;
		let misses = 0;
		for (const [dx, dy] of offsets) {
			const hit = document.elementFromPoint(cx + dx, cy + dy);
			if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) misses++;
		}
		if (!misses) continue;
		const name = `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ')[0]}` : ''}`;
		(small[name] ??= []).push(
			`${Math.round(box.width)}×${Math.round(box.height)} misses ${misses}/8`,
		);
	}
	return Object.entries(small).map(([name, hits]) => `${name} ×${hits.length} ${hits[0]}`);
};

const browser = await chromium.launch();
let failures = 0;
const smallTargets = new Set();

for (const profile of PROFILES) {
	const { width, touch, play } = profile;
	const context = await browser.newContext(viewportOptions(profile, HEIGHT));
	await context.addInitScript(
		({ theme, locale }) => {
			if (localStorage.getItem('charnik:app') === null) {
				localStorage.setItem('charnik:app', JSON.stringify({ theme, activeLocale: locale }));
			}
		},
		{ theme: THEME, locale: LOCALE },
	);
	const page = await context.newPage();
	console.log(
		`\n=== ${width}×${HEIGHT} · ${touch ? 'touch' : 'mouse'} · ${THEME}${LOCALE ? ` · ${LOCALE}` : ''} ===`,
	);
	for (const route of ROUTES) {
		await page.goto(BASE + route, { waitUntil: 'networkidle' }).catch(() => {});
		await dismissMobileWarning(page);
		await page.waitForTimeout(450);
		const root = page.locator('html');
		const wrongLocale = LOCALE && (await root.getAttribute('lang')) !== LOCALE;
		const wrongTheme = (await root.getAttribute('data-theme')) !== THEME;
		const wrongMotion = (await root.getAttribute('data-motion')) !== 'reduced';
		const wrongLayout = play && route === '/combat' && !(await page.locator(play).isVisible());
		const result = await page.evaluate(findOverflow);
		const scrolls = result.documentWidth > result.viewport + 1;
		const bad =
			scrolls ||
			result.offenders.length > 0 ||
			result.noMain ||
			wrongLayout ||
			wrongLocale ||
			wrongTheme ||
			wrongMotion;
		if (bad) failures++;
		console.log(
			`${bad ? '✗' : '✓'} ${route} — document=${result.documentWidth}${scrolls ? ' PAGE SCROLLS SIDEWAYS' : ''}${result.noMain ? ' NO <main> — THE ROUTE DID NOT RENDER, NOTHING WAS MEASURED' : ` main=${result.mainScrollWidth}`} offenders=${result.offenders.length}`,
		);
		if (wrongLayout) console.log(`      expected ${play}`);
		if (wrongLocale || wrongTheme || wrongMotion)
			console.log('      requested locale, theme or reduced motion did not apply');
		for (const offender of result.offenders.slice(0, 8)) console.log(`      ${offender}`);
		// a tap target is a property of the control, not of the width, so once per run — and it scrolls
		// every control into view, which makes it the slow half
		if (width === PROFILES.find(({ touch }) => touch)?.width) {
			for (const target of await page.evaluate(findSmallTargets))
				smallTargets.add(`${route}  ${target}`);
		}
	}
	await context.close();
}

await browser.close();
if (smallTargets.size) {
	console.log(`\n${smallTargets.size} control(s) a finger cannot reliably hit (advisory):`);
	for (const target of smallTargets) console.log(`   ${target}`);
}
if (failures) {
	console.log(`\n${failures} route check(s) failed — see the details above.`);
	process.exit(1);
}
console.log('\nno overflow');
