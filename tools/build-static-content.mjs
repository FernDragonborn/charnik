/*
 * VENDOR the content into `static/content/` so the build serves it as static assets (fetched by
 * FetchStorage on web, seeded onto disk on desktop), and emit a `manifest.json` — HTTP has no
 * directory listing, so the loader's `list(root)` reads the manifest instead.
 *
 * The CSVs come from the SEPARATE content repo (see tools/content-repo.mjs); this step is what
 * makes a release carry them as its bundled floor. Missing content fails LOUDLY here rather than
 * producing a build with no rules in it.
 *
 * Runs as `predev`/`prebuild` (see package.json), and again on every change while the dev server is
 * up (the content watcher in `vite.config.ts` calls `vendorContent`). `static/content/` is generated
 * + gitignored.
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

/** A plugin is only a plugin at `<pack>/plugins/<namespace>/` (PLUGINS §2) — code anywhere else in
 *  a pack is loaded by nothing and disclosed by nothing. */
const PLUGIN_DIR = /\/plugins\/[^/]+$/;

/**
 * Which files a pack actually ships. The TS twin is `isPackFile` in `content/remote/github.ts`, and
 * the two must agree: that one decides what an installed pack contains, this one decides what a
 * BUNDLED pack contains, and a pack is supposed to be the same thing however it arrived. Hence the
 * directory argument — the twin reads the same rule off a full path.
 * @param {string} dirRel @param {string} name
 */
const isPackFile = (dirRel, name) =>
	name.endsWith('.csv') ||
	(PLUGIN_DIR.test(dirRel) && (name === 'plugin.json' || name === 'main.js'));

/**
 * Directory → its files, at every depth, keyed the way the manifest wants them (one entry per
 * DIRECTORY, since that is what stands in for a listing over HTTP). Recursive because a pack may
 * carry plugins in `plugins/<ns>/` (PLUGINS §2) — a flat walk vendored the data and silently
 * dropped the code, so a bundled pack could not carry a plugin at all.
 * @param {string} dir @param {string} rel @param {Record<string, string[]>} into
 */
function collect(dir, rel, into) {
	const files = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) collect(join(dir, entry.name), `${rel}/${entry.name}`, into);
		else if (isPackFile(rel, entry.name)) files.push(entry.name);
	}
	// a directory of nothing we ship gets no manifest key — an empty one would report as a
	// subdirectory of its parent and pack discovery scans for exactly those
	if (files.length > 0) into[rel] = files.sort();
	return into;
}

/** Copy every pack into `static/content/` and write the manifest beside them. Throws when the
 *  content repo isn't there — a caller decides whether that ends the process (the CLI below) or is
 *  reported and survived (the dev watcher). */
export function vendorContent() {
	requireContentRepo();
	if (existsSync(destBase)) rmSync(destBase, { recursive: true, force: true });
	mkdirSync(destBase, { recursive: true });

	/** @type {{ roots: Record<string, string[]> }} */
	const manifest = { roots: {} };
	for (const pack of contentPacks()) {
		const srcDir = packDir(pack);
		// the runtime path stays `content/<pack>` — where it came from is a build-time detail
		const rel = `content/${pack}`;
		for (const [dirRel, files] of Object.entries(collect(srcDir, rel, {}))) {
			const outDir = resolve(root, 'static', dirRel);
			mkdirSync(outDir, { recursive: true });
			const from = join(srcDir, dirRel.slice(rel.length));
			for (const f of files) copyFileSync(join(from, f), resolve(outDir, f));
			manifest.roots[dirRel] = files;
		}
	}
	writeFileSync(resolve(destBase, 'manifest.json'), JSON.stringify(manifest, null, 2));
	return manifest;
}

// run as a script (`predev`/`prebuild`) → vendor once and say what landed; missing content is fatal
// HERE rather than a build with no rules in it
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		const manifest = vendorContent();
		console.log(
			`static content (from ${requireContentRepo()}):`,
			Object.entries(manifest.roots)
				.map(([r, fs]) => `${r} (${fs.length})`)
				.join(', '),
		);
	} catch (e) {
		console.error(`
${e instanceof Error ? e.message : e}
`);
		process.exit(1);
	}
}
