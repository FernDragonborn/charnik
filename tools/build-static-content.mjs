/*
 * Copy the shipped content roots into `static/content/` so the web build serves them as
 * static assets (fetched by FetchStorage), and emit a `manifest.json` — HTTP has no
 * directory listing, so the loader's `list(root)` reads the manifest instead.
 *
 * Runs as `predev`/`prebuild` (see package.json). `static/content/` is generated + gitignored.
 */
import { readdirSync, mkdirSync, copyFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// one folder under content/ = one content pack; scan for them rather than listing them here, so a
// pack added to the repo ships on the web with no edit to this script (AI-CONVENTIONS §1.6)
const ROOTS = readdirSync(resolve(root, 'content'), { withFileTypes: true })
	.filter((e) => e.isDirectory() && e.name !== 'homebrew')
	.map((e) => `content/${e.name}`)
	.sort();
const destBase = resolve(root, 'static/content');

if (existsSync(destBase)) rmSync(destBase, { recursive: true, force: true });
mkdirSync(destBase, { recursive: true });

const manifest = { roots: {} };
for (const rel of ROOTS) {
	const srcDir = resolve(root, rel);
	if (!existsSync(srcDir)) continue;
	const files = readdirSync(srcDir).filter((f) => f.endsWith('.csv') || f.endsWith('.json'));
	const outDir = resolve(root, 'static', rel);
	mkdirSync(outDir, { recursive: true });
	for (const f of files) copyFileSync(resolve(srcDir, f), resolve(outDir, f));
	manifest.roots[rel] = files;
}
writeFileSync(resolve(destBase, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(
	'static content:',
	Object.entries(manifest.roots)
		.map(([r, fs]) => `${r} (${fs.length})`)
		.join(', ')
);
