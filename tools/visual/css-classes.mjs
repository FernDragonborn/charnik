/*
 * Full CSS class inventory: every class defined in a <style> block or .css, with the file(s) it
 * appears in and a ⚠ mark for short/cryptic names (≤3 chars, or no vowel-y word shape) so collisions
 * and leftover abbreviations are easy to eyeball.
 *
 *   node tools/visual/css-classes.mjs            # all, alphabetical
 *   node tools/visual/css-classes.mjs cryptic    # only the ⚠ short/cryptic ones
 *   node tools/visual/css-classes.mjs multi       # only names in 2+ files
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MODE = process.argv[2] || 'all';

function walk(dir, out = []) {
	for (const e of readdirSync(dir)) {
		const p = join(dir, e);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.(svelte|css)$/.test(e) && !/\.test\./.test(e)) out.push(p);
	}
	return out;
}

const byName = new Map(); // name → Set(files)
for (const file of walk('src')) {
	let css = readFileSync(file, 'utf8');
	if (file.endsWith('.svelte')) {
		const m = css.match(/<style>([\s\S]*)<\/style>/);
		css = m ? m[1] : '';
	}
	css = css.replace(/\/\*[\s\S]*?\*\//g, '');
	for (const m of css.matchAll(/\.([a-z][a-z0-9-]*)/gi)) {
		if (!byName.has(m[1])) byName.set(m[1], new Set());
		byName.get(m[1]).add(file.replace(/\\/g, '/').replace('src/', ''));
	}
}

// cryptic = ≤3 chars, OR looks like a consonant-abbreviation (no full word), excluding kebab compounds
const isCryptic = (n) =>
	(n.length <= 3 || !/[aeiou]/.test(n.replace(/-/g, ''))) && !n.includes('-');

let names = [...byName.keys()].sort();
if (MODE === 'cryptic') names = names.filter(isCryptic);
if (MODE === 'multi') names = names.filter((n) => byName.get(n).size >= 2);

console.log(`\n=== ${names.length} class names (${MODE}) ===\n`);
for (const n of names) {
	const files = [...byName.get(n)];
	const mark = isCryptic(n) ? '⚠ ' : '  ';
	const multi = files.length >= 2 ? ` [${files.length} files]` : '';
	console.log(`${mark}.${n}${multi}  —  ${files.join(', ')}`);
}
console.log(`\ntotal ${byName.size} distinct class names.`);
