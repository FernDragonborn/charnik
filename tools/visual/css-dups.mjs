/*
 * CSS duplication survey. Scans every .svelte <style> block + .css file, extracts each leaf rule
 * (selector + declarations, incl. those nested in @media), normalises the declaration set (sorted,
 * comment-stripped) and groups identical declaration blocks that appear in 2+ places — the candidates
 * to hoist into a shared/global stylesheet. Prints the biggest/most-frequent duplicates first.
 *
 *   node tools/visual/css-dups.mjs [minDecls]   (default minDecls=2 — ignore trivial 1-prop rules)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MIN_DECLS = Number(process.argv[2] || 2);
const ROOT = 'src';

function walk(dir, out = []) {
	for (const e of readdirSync(dir)) {
		const p = join(dir, e);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.(svelte|css)$/.test(e) && !/\.test\./.test(e)) out.push(p);
	}
	return out;
}

/** rule declaration-key → list of { file, selector, n } */
const groups = new Map();

for (const file of walk(ROOT)) {
	let css = readFileSync(file, 'utf8');
	if (file.endsWith('.svelte')) {
		const m = css.match(/<style>([\s\S]*)<\/style>/);
		css = m ? m[1] : '';
	}
	css = css.replace(/\/\*[\s\S]*?\*\//g, ''); // strip comments
	for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const selector = m[1].trim().replace(/\s+/g, ' ');
		if (selector.startsWith('@') || selector.includes('keyframes')) continue;
		const decls = m[2]
			.split(';')
			.map((d) => d.trim())
			.filter(Boolean)
			.sort();
		if (decls.length < MIN_DECLS) continue;
		const key = decls.join(';');
		if (!groups.has(key)) groups.set(key, { decls, hits: [] });
		groups.get(key).hits.push({ file: file.replace(/\\/g, '/'), selector });
	}
}

const dups = [...groups.values()]
	.filter((g) => g.hits.length >= 2)
	.map((g) => ({ ...g, score: g.hits.length * g.decls.length }))
	.sort((a, b) => b.score - a.score);

// cross-file duplicates (the best hoist candidates) first, then same-file
const crossFile = dups.filter((g) => new Set(g.hits.map((h) => h.file)).size >= 2);
console.log(
	`\n=== ${dups.length} duplicated declaration-blocks (${crossFile.length} span >1 file) ===\n`
);
for (const g of dups.slice(0, 30)) {
	const files = new Set(g.hits.map((h) => h.file));
	const tag = files.size >= 2 ? '🌐 CROSS-FILE' : 'same-file';
	console.log(`[${g.hits.length}×, ${g.decls.length} decls] ${tag}`);
	console.log('   { ' + g.decls.join('; ') + ' }');
	for (const h of g.hits) console.log(`   · ${h.selector}   (${h.file})`);
	console.log();
}
