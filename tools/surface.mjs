#!/usr/bin/env node
/*
 * Reuse-surface index generator — writes docs/SURFACE.md.
 *
 * WHY: the agent (and humans) keep re-creating CSS classes / TS helpers that already exist,
 * because the shared surface isn't discoverable at a glance. This scans src/lib and emits a
 * compact, grouped catalog of everything MEANT to be reused — design tokens, global CSS classes,
 * shared components, stores, and library functions/types — so "is this already here?" is one
 * cheap read instead of a hopeful re-implementation. Pure static scan (regex, no build, no deps);
 * sub-second on this repo, so it's meant to be run on demand (`pnpm surface`) before writing code.
 *
 * Deliberately covers ONLY src/lib (the reuse surface). Route-local code (src/routes) and tests
 * are noise here and excluded. Not a linter — it lists, it doesn't judge.
 *
 * EXCEPTION: the "Duplicate suspects" section scans ALL of src (lib + routes, incl. .svelte
 * script blocks) — semantic duplicates hide precisely in route-local code, invisible to jscpd
 * (different shapes) and knip (all used). Three cheap detectors: same-name definitions in 2+
 * files; identical param-normalized one-liner arrow bodies; identical literal arrays. A review
 * list, not a gate — false positives are acceptable, silence about a real dup is not.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src', 'lib');
const OUT = join(ROOT, 'docs', 'SURFACE.md');
const STYLES = join(SRC, 'styles');

const t0 = Date.now();

/** All files under a dir, recursively. */
function walk(dir, out = []) {
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');
const read = (p) => readFileSync(p, 'utf8');

const files = walk(SRC);
const isTest = (p) => /\.(test|spec)\.[jt]s$/.test(p);
const tsFiles = files.filter((p) => /\.(ts|svelte\.ts)$/.test(p) && !isTest(p));
const svelteFiles = files.filter((p) => p.endsWith('.svelte'));

/** First human sentence of a comment block sitting directly above a line index. */
function leadComment(lines, idx) {
	let i = idx - 1;
	const buf = [];
	if (i >= 0 && lines[i].trim().endsWith('*/')) {
		while (i >= 0) {
			buf.unshift(lines[i]);
			if (lines[i].includes('/*')) break;
			i--;
		}
	} else {
		while (i >= 0 && lines[i].trim().startsWith('//')) {
			buf.unshift(lines[i]);
			i--;
		}
	}
	const text = buf
		.join(' ')
		.replace(/\/\*+|\*+\/|^\s*\*+/g, ' ')
		.replace(/\s*\/\/+\s?/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!text) return '';
	const sentence = text.split(/(?<=[.!?])\s/)[0];
	return sentence.length > 120 ? sentence.slice(0, 117) + '…' : sentence;
}

// ---------------------------------------------------------------- design tokens
function collectTokens() {
	const src = read(join(STYLES, 'tokens.css'));
	const groups = new Map(); // section -> [{name, value}]
	let section = 'misc';
	const seen = new Set();
	for (const line of src.split('\n')) {
		const head = line.match(/\/\*\s*-*\s*(.+?)\s*-*\s*\*\//);
		if (head) {
			section = head[1].trim();
			continue;
		}
		const tok = line.match(/^\s*(--[\w-]+)\s*:\s*([^;]+);/);
		if (tok && !seen.has(tok[1])) {
			seen.add(tok[1]);
			if (!groups.has(section)) groups.set(section, []);
			groups.get(section).push({ name: tok[1], value: tok[2].trim() });
		}
	}
	return groups;
}

// --------------------------------------------------------- global CSS classes
/** Class names defined in a CSS-ish body, with the comment that precedes each rule. */
function classesFrom(body, sourceLabel) {
	const out = [];
	const lines = body.split('\n');
	// crude but effective: a selector line ends in `{`; grab `.class` tokens from it.
	lines.forEach((line, idx) => {
		if (!/\{\s*$/.test(line)) return;
		const selector = line.slice(0, line.indexOf('{'));
		const names = selector.match(/\.[a-zA-Z][\w-]*/g);
		if (!names) return;
		const note = leadComment(lines, idx);
		for (const n of names) out.push({ name: n, source: sourceLabel, note });
	});
	return out;
}
function collectGlobalClasses() {
	const map = new Map(); // class -> {sources:Set, note}
	const add = (name, source, note) => {
		if (!map.has(name)) map.set(name, { sources: new Set(), note: '' });
		const e = map.get(name);
		e.sources.add(source);
		if (note && !e.note) e.note = note;
	};
	for (const css of ['app.css', 'components.css']) {
		const p = join(STYLES, css);
		try {
			for (const c of classesFrom(read(p), css)) add(c.name, c.source, c.note);
		} catch {
			// file may not exist — skip.
		}
	}
	// `:global(...)` blocks inside component <style> are also global surface.
	for (const p of svelteFiles) {
		const body = read(p);
		const globals = body.match(/:global\(([^)]*)\)/g);
		if (!globals) continue;
		for (const g of globals) {
			const names = g.match(/\.[a-zA-Z][\w-]*/g);
			if (names) for (const n of names) add(n, `${basename(p)} :global`, '');
		}
	}
	return map;
}

// --------------------------------------------------------- shared components
function collectComponents() {
	return svelteFiles
		.filter((p) => rel(p).includes('/components/'))
		.map((p) => {
			const body = read(p);
			const lines = body.split('\n');
			const typed = body.match(/let\s*\{([^}]*)\}\s*:\s*\{[\s\S]*?\}\s*=\s*\$props\(\)/);
			const plain = body.match(/let\s*\{([^}]*)\}\s*=\s*\$props\(\)/);
			const rawProps = (typed || plain)?.[1] ?? '';
			const props = rawProps
				.split(',')
				.map((s) =>
					s
						.trim()
						.replace(/[=:].*$/s, '')
						.replace(/^\.\.\./, '')
						.trim()
				)
				.filter(Boolean);
			// leading comment = first // line inside <script>
			const scriptStart = lines.findIndex((l) => l.includes('<script'));
			const note = scriptStart >= 0 ? leadComment(lines, scriptStart + 2) : '';
			return { name: basename(p, '.svelte'), path: rel(p), props, note };
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

// ------------------------------------------------- library functions / types
const EXPORT_RE =
	/^export\s+(?:async\s+)?(function|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
// `export { a, b as c }` re-export/alias lists (e.g. i18n re-exporting svelte-i18n's `_`).
const EXPORT_BLOCK_RE = /^export\s+(?:type\s+)?\{([^}]*)\}/;
function collectExports() {
	const byModule = new Map(); // relPath -> [{kind, name, note}]
	for (const p of tsFiles) {
		const lines = read(p).split('\n');
		const items = [];
		lines.forEach((line, idx) => {
			const m = line.match(EXPORT_RE);
			if (m) {
				items.push({ kind: m[1], name: m[2], note: leadComment(lines, idx) });
				return;
			}
			const block = line.match(EXPORT_BLOCK_RE);
			if (block) {
				const note = leadComment(lines, idx);
				for (const piece of block[1].split(',')) {
					// the exported (public) name is the alias when `x as y` is used
					const name = piece
						.trim()
						.split(/\s+as\s+/)
						.pop()
						?.trim();
					if (name) items.push({ kind: 're-export', name, note });
				}
			}
		});
		if (items.length) byModule.set(rel(p), items);
	}
	return byModule;
}

// ------------------------------------------------------- duplicate suspects
/** Every scannable code body across ALL of src: .ts files as-is, .svelte script blocks. */
function collectCodeBodies() {
	const out = [];
	for (const p of walk(join(ROOT, 'src'))) {
		if (isTest(p)) continue;
		if (/\.(ts|svelte\.ts)$/.test(p)) out.push({ file: rel(p), body: read(p) });
		else if (p.endsWith('.svelte')) {
			const scripts = [...read(p).matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
			if (scripts.length) out.push({ file: rel(p), body: scripts.map((m) => m[1]).join('\n') });
		}
	}
	return out;
}

/** Function-ish declarations + UPPER_SNAKE consts, top-level or not (dups hide in class bodies
 *  and <script> blocks too, so no indentation anchor). */
const FN_DECL_RE = /(?:^|\s)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g;
const CONST_FN_RE =
	/(?:^|\s)(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]{0,80})?=\s*(?:async\s*)?(?:\(|[A-Za-z_$][\w$]*\s*=>)/g;
const UPPER_CONST_RE = /(?:^|\s)(?:export\s+)?const\s+([A-Z][A-Z0-9_]{2,})\s*[:=]/g;
/** One-liner arrow with an expression body: `const name = (a, b) => expr;` */
const ARROW_ONELINER_RE =
	/(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*\(([^)]*)\)(?:\s*:[^=]{0,60})?\s*=>\s*([^;{][^;\n]{15,});/g;
/** Literal arrays with 3+ elements (single- or multi-line), e.g. the ability list. */
const ARRAY_CONST_RE =
	/(?:^|\s)(?:export\s+)?const\s+([A-Za-z_$][\w$]*)(?:\s*:[^=]{0,80})?\s*=\s*(\[[^\]]{10,400}?\])(?:\s*as\s+const)?/g;

/** Names that legitimately recur per-file (Svelte/idiom wiring) — everything else is a suspect. */
const NAME_STOPLIST = new Set(['handleKeydown', 'onMount', 'children']);

function collectDupSuspects() {
	const nameSites = new Map(); // name -> Set<file>
	const bodySites = new Map(); // normalized body -> [{name, file}]
	const arraySites = new Map(); // normalized array literal -> [{name, file}]
	const addSite = (map, key, val) => {
		if (!map.has(key)) map.set(key, []);
		map.get(key).push(val);
	};
	for (const { file, body } of collectCodeBodies()) {
		const names = new Set();
		for (const re of [FN_DECL_RE, CONST_FN_RE, UPPER_CONST_RE])
			for (const m of body.matchAll(re)) names.add(m[1]);
		for (const n of names) {
			if (NAME_STOPLIST.has(n)) continue;
			if (!nameSites.has(n)) nameSites.set(n, new Set());
			nameSites.get(n).add(file);
		}
		for (const m of body.matchAll(ARROW_ONELINER_RE)) {
			const [, name, params, expr] = m;
			let norm = expr;
			params
				.split(',')
				.map((s) =>
					s
						.trim()
						.replace(/[?:=].*$/s, '')
						.trim()
				)
				.filter(Boolean)
				.forEach((p, i) => {
					norm = norm.replace(new RegExp(`\\b${p}\\b`, 'g'), `$p${i}`);
				});
			addSite(bodySites, norm.replace(/\s+/g, ''), { name, file });
		}
		for (const m of body.matchAll(ARRAY_CONST_RE)) {
			const items = m[2].replace(/['"`\s]/g, '');
			if (items.split(',').length >= 3) addSite(arraySites, items, { name: m[1], file });
		}
	}
	const spansFiles = (sites) => new Set(sites.map((s) => s.file)).size >= 2;
	return {
		sameName: [...nameSites]
			.filter(([, files]) => files.size >= 2)
			.map(([name, files]) => ({ name, files: [...files].sort() }))
			.sort((a, b) => b.files.length - a.files.length || a.name.localeCompare(b.name)),
		sameBody: [...bodySites.values()]
			.filter(spansFiles)
			// same-name groups already surface above — keep body groups that add NEW information
			.filter((sites) => new Set(sites.map((s) => s.name)).size >= 2)
			.sort((a, b) => b.length - a.length),
		sameArray: [...arraySites.values()].filter(spansFiles).sort((a, b) => b.length - a.length)
	};
}

// ------------------------------------------------------------------- render
const esc = (s) => s.replace(/\|/g, '\\|');
const out = [];
out.push('<!-- GENERATED by tools/surface.mjs — run `pnpm surface`. Do not edit by hand. -->');
out.push('');
out.push('# Charnik reuse surface');
out.push('');
out.push('Catalog of the **shared, reusable surface** under `src/lib` — design tokens, global CSS');
out.push(
	'classes, shared components, stores, and library functions/types. Consult this (and `grep`)'
);
out.push(
	'BEFORE writing a CSS class or a TS helper, so existing ones get reused instead of duplicated.'
);
out.push('Regenerate with `pnpm surface`. Covers `src/lib` only (routes/tests excluded),');
out.push('EXCEPT the duplicate-suspects section, which scans all of `src`.');
out.push('');

// duplicate suspects (rendered first — it's the "stop, this already exists" list)
const dups = collectDupSuspects();
const dupCount = dups.sameName.length + dups.sameBody.length + dups.sameArray.length;
out.push(`## Duplicate suspects (${dupCount})`);
out.push('');
out.push('Review list, NOT a gate: same names / identical bodies / identical literal arrays in');
out.push('2+ files. Before adding to it, check whether the shared home already exists; before');
out.push('fixing one, differential-test where bodies differ (PLAN MECH6). Some are fine (a name');
out.push('reused for genuinely different things) — judge, then either merge or leave.');
out.push('');
if (dups.sameName.length) {
	out.push('**Same name, several files:**');
	out.push('');
	for (const d of dups.sameName)
		out.push(`- \`${d.name}\` ×${d.files.length} — ${d.files.join(' · ')}`);
	out.push('');
}
if (dups.sameBody.length) {
	out.push('**Identical one-liner body, different names:**');
	out.push('');
	for (const g of dups.sameBody)
		out.push(`- ${g.map((s) => `\`${s.name}\` (${s.file})`).join(' = ')}`);
	out.push('');
}
if (dups.sameArray.length) {
	out.push('**Identical literal array:**');
	out.push('');
	for (const g of dups.sameArray)
		out.push(`- ${g.map((s) => `\`${s.name}\` (${s.file})`).join(' = ')}`);
	out.push('');
}

// tokens
const tokens = collectTokens();
let tokenCount = 0;
out.push('## Design tokens (`styles/tokens.css`)');
out.push('');
out.push('Style **only** through these — never hardcode a color/size. Names are semantic.');
out.push('');
for (const [section, list] of tokens) {
	out.push(`**${section}** — ${list.map((t) => `\`${t.name}\``).join(', ')}`);
	out.push('');
	tokenCount += list.length;
}

// global classes
const classes = collectGlobalClasses();
out.push(`## Global CSS classes (${classes.size})`);
out.push('');
out.push('A shared class lives in exactly ONE place. Reuse before making a scoped lookalike.');
out.push('');
out.push('| Class | Defined in | Purpose |');
out.push('| --- | --- | --- |');
for (const name of [...classes.keys()].sort()) {
	const e = classes.get(name);
	out.push(`| \`${name}\` | ${esc([...e.sources].join(', '))} | ${esc(e.note)} |`);
}
out.push('');

// components
const components = collectComponents();
out.push(`## Shared components (${components.length})`);
out.push('');
out.push('| Component | Props | Purpose |');
out.push('| --- | --- | --- |');
for (const c of components) {
	const props = c.props.length ? c.props.map((p) => `\`${p}\``).join(', ') : '—';
	out.push(`| **${c.name}** | ${esc(props)} | ${esc(c.note)} |`);
}
out.push('');

// stores vs lib functions
const exportsByModule = collectExports();
const storeModules = [...exportsByModule.keys()].filter(
	(m) => m.includes('/stores/') || m.endsWith('.svelte.ts')
);
const libModules = [...exportsByModule.keys()].filter((m) => !storeModules.includes(m)).sort();

function renderModules(list) {
	for (const m of list) {
		out.push(`### \`${m}\``);
		out.push('');
		for (const it of exportsByModule.get(m)) {
			const note = it.note ? ` — ${it.note}` : '';
			out.push(`- \`${it.kind} ${it.name}\`${note}`);
		}
		out.push('');
	}
}

let exportCount = 0;
for (const items of exportsByModule.values()) exportCount += items.length;

out.push(`## Stores & reactive state (${storeModules.length} modules)`);
out.push('');
renderModules(storeModules.sort());

out.push(`## Library functions & types (${libModules.length} modules)`);
out.push('');
renderModules(libModules);

const ms = Date.now() - t0;
out.push('---');
out.push(
	`_${tokenCount} tokens · ${classes.size} global classes · ${components.length} components · ` +
		`${exportCount} exports across ${exportsByModule.size} modules · ${dupCount} duplicate suspects · ` +
		`generated in ${ms}ms._`
);
out.push('');

writeFileSync(OUT, out.join('\n'));
console.log(
	`surface → ${rel(OUT)}  (${tokenCount} tokens, ${classes.size} classes, ${components.length} components, ${exportCount} exports, ${dupCount} dup suspects; ${ms}ms)`
);
