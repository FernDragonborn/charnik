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

// A small allowlist of real single words that are fine on their own (not abbreviations).
const WORDS = new Set(
	`btn nav card body head item page list note save name text icon edit view menu row col cell tag chip
	 pill dot pip star gold teal warn done free full open lock knob band base bare bool auto meta main
	 hero grid group count date dates dice tray pool prep prof rest heal temp tile trace types used util
	 wide small span none empty entry field file files input modal popup level total stat stats strip
	 check ready muted spent bonus boost pick drop over acts hint sub two dim on off die eye set new add
	 mod res neg pos big rev asi ctrls req opt`.split(/\s+/)
);
// cryptic = a single token (no hyphen) that is short (≤6) AND not a plain allow-listed word — catches
// glued abbreviations like .aedot / .pchip / .iname that a vowel test misses.
const isCryptic = (n) =>
	!n.includes('-') && n.length <= 6 && !WORDS.has(n) && !/^[a-z]\d+$/.test(n);

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
