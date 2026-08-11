/*
 * VENDOR the content into `static/content/` so the build serves it as static assets (fetched by
 * FetchStorage on web, seeded onto disk on desktop), and emit a `manifest.json` — HTTP has no
 * directory listing, so the loader's `list(root)` reads the manifest instead.
 *
 * The CSVs come from the SEPARATE content repo (see tools/content-repo.mjs); this step is what
 * makes a release carry them as its bundled floor. Missing content fails LOUDLY here rather than
 * producing a build with no rules in it.
 *
 * Runs as `predev`/`prebuild` (see package.json). `static/content/` is generated + gitignored.
 */
import { readdirSync, mkdirSync, copyFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentPacks, packDir, requireContentRepo } from './content-repo.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destBase = resolve(root, 'static/content');

try {
	requireContentRepo();
} catch (e) {
	console.error(`\n${e instanceof Error ? e.message : e}\n`);
	process.exit(1);
}

if (existsSync(destBase)) rmSync(destBase, { recursive: true, force: true });
mkdirSync(destBase, { recursive: true });

const manifest = { roots: {} };
for (const pack of contentPacks()) {
	const srcDir = packDir(pack);
	const files = readdirSync(srcDir).filter((f) => f.endsWith('.csv') || f.endsWith('.json'));
	// the runtime path stays `content/<pack>` — where it came from is a build-time detail
	const rel = `content/${pack}`;
	const outDir = resolve(root, 'static', rel);
	mkdirSync(outDir, { recursive: true });
	for (const f of files) copyFileSync(join(srcDir, f), resolve(outDir, f));
	manifest.roots[rel] = files;
}
writeFileSync(resolve(destBase, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(
	`static content (from ${requireContentRepo()}):`,
	Object.entries(manifest.roots)
		.map(([r, fs]) => `${r} (${fs.length})`)
		.join(', ')
);
