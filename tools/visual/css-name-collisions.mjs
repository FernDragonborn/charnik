/*
 * Class-NAME collision survey (the inverse of css-dups). Finds class names that appear in 2+ files
 * with DIFFERENT declaration sets — i.e. the same short name means different things in different
 * components (confusing even though Svelte scopes them). These want context-specific renames.
 *
 *   node tools/visual/css-name-collisions.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir, out = []) {
	for (const e of readdirSync(dir)) {
		const p = join(dir, e);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.(svelte|css)$/.test(e) && !/\.test\./.test(e)) out.push(p);
	}
	return out;
}

// className → Map(file → Set(normalized decl-blocks it appears in))
const byName = new Map();

for (const file of walk('src')) {
	let css = readFileSync(file, 'utf8');
	if (file.endsWith('.svelte')) {
		const m = css.match(/<style>([\s\S]*)<\/style>/);
		css = m ? m[1] : '';
	}
	if (file.endsWith('components.css')) continue; // the shared globals are the intended single home
	css = css.replace(/\/\*[\s\S]*?\*\//g, '');
	for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const sel = m[1].trim();
		if (sel.startsWith('@')) continue;
		const decls = m[2]
			.split(';')
			.map((d) => d.trim())
			.filter(Boolean)
			.sort()
			.join('; ');
		// pull each class name out of the selector
		for (const cm of sel.matchAll(/\.([a-z][a-z0-9-]*)/gi)) {
			const name = cm[1];
			if (!byName.has(name)) byName.set(name, new Map());
			const perFile = byName.get(name);
			if (!perFile.has(file)) perFile.set(file, new Set());
			perFile.get(file).add(decls);
		}
	}
}

const collisions = [];
for (const [name, perFile] of byName) {
	if (perFile.size < 2) continue; // only in one file → fine
	// distinct declaration blocks across files
	const blocks = new Set();
	for (const set of perFile.values()) for (const b of set) blocks.add(b);
	if (blocks.size < 2) continue; // same name, SAME style everywhere → a dup (handled by css-dups)
	collisions.push({ name, files: [...perFile.keys()], variants: blocks.size });
}
collisions.sort((a, b) => b.files.length - a.files.length || b.variants - a.variants);

console.log(
	`\n=== ${collisions.length} class names reused across files with DIFFERENT styles ===\n`
);
for (const c of collisions) {
	console.log(`.${c.name}  (${c.files.length} files, ${c.variants} distinct styles)`);
	for (const f of c.files) console.log(`   · ${f.replace(/\\/g, '/')}`);
}
