/*
 * Where the SRD content lives — the ONE resolver for it.
 *
 * The content is its OWN repository (`charnik-content-srd`) so rules data can be corrected and
 * released WITHOUT shipping an app build (docs/plan.md · REL-4 slice 0). Clone it beside this repo
 * and nothing needs configuring; anything else is a config or an env var. Everything that reads the
 * shipped CSVs from disk — the static-content vendoring step, the SRD converters, the content tests
 * — comes through here, so the location is stated in exactly one place.
 *
 * Resolution order: `$CHARNIK_CONTENT` (CI) → `charnik.dev.json` `contentRepo` → the sibling.
 *
 * The dev pointer is `charnik.dev.json` and NOT `charnik.config.json`, even though this key used to
 * live there: `charnik.config.json` is also the name of the app's RUNTIME config in the user's data
 * folder, with a completely different schema. One name for two unrelated files is a question
 * ("which one do you mean?") that gets asked forever; renaming the dev-only one costs nothing.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const CONTENT_REPO_URL = 'https://github.com/FernDragonborn/charnik-content-srd.git';
const DEFAULT_DIR = '../charnik-content-srd';
const CONFIG_FILE = 'charnik.dev.json';

/** The configured `contentRepo`, or null when there's no config / no such key / unreadable JSON. */
function configuredDir() {
	try {
		const cfg = JSON.parse(readFileSync(resolve(appRoot, CONFIG_FILE), 'utf8'));
		return typeof cfg?.contentRepo === 'string' ? cfg.contentRepo : null;
	} catch {
		return null;
	}
}

/** Absolute path the content repo SHOULD be at (relative paths resolve against the app repo root).
 *  Not verified — use {@link requireContentRepo} when you're about to read from it. */
export function contentRepoDir() {
	return resolve(appRoot, process.env.CHARNIK_CONTENT || configuredDir() || DEFAULT_DIR);
}

/** As above, but throws an actionable error if the content isn't there — never let a missing clone
 *  degrade into an app with no rules in it (a silent empty compendium is the worst outcome). */
export function requireContentRepo() {
	const dir = contentRepoDir();
	if (existsSync(dir)) return dir;
	throw new Error(
		`Content not found at ${dir}\n\n` +
			`The SRD content is a separate repository. Clone it beside this one:\n` +
			`    git clone ${CONTENT_REPO_URL} ${DEFAULT_DIR}\n\n` +
			`Already have it elsewhere? Point at it with either\n` +
			`    ${CONFIG_FILE}:  { "contentRepo": "../wherever/charnik-content-srd" }\n` +
			`    or the CHARNIK_CONTENT environment variable.`,
	);
}

/** Absolute path of one content pack (a pack is a top-level FOLDER of the content repo).
 *  @param {string} pack */
export function packDir(pack) {
	return join(requireContentRepo(), pack);
}

/** Every installed pack, by folder name — discovered by scanning, since a folder listing IS the
 *  file list and there is no manifest to keep in sync (docs/internals/content.md ▸ No manifests). Sorted only for
 *  determinism: nothing may read meaning into pack order.
 *
 *  A pack qualifies on holding a CSV **or** a `plugins/` subtree, matching what the remote side
 *  counts as a pack (`packsFromTree`): a pack may be code only (PLUGINS §2), and a rule that only
 *  the bundling step disagrees with would make such a pack installable but not shippable. */
export function contentPacks() {
	const dir = requireContentRepo();
	return readdirSync(dir, { withFileTypes: true })
		.filter(
			(e) =>
				e.isDirectory() &&
				readdirSync(join(dir, e.name)).some((f) => f.endsWith('.csv') || f === 'plugins'),
		)
		.map((e) => e.name)
		.sort();
}
