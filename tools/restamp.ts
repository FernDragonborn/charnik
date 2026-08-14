/*
 * Re-stamp a content CSV's `#content-hash` (+ `updated_at`) after a HAND-EDIT — in place, WITHOUT
 * regenerating rows. Use this instead of re-running a converter when you've edited a content CSV by
 * hand (e.g. added an effect token to a feat): a converter re-run can churn UNRELATED files (it drops
 * `conditions_srd.csv`'s `max_level` column — a stale-converter bug), whereas this touches only the
 * two hash/date directive lines of the files you name.
 *
 * The stamping itself is the APP's own `restampText` (src/lib/content/restamp.ts) — the same function
 * the in-app drift pop-up calls — so a file stamped from the terminal and one stamped from the UI are
 * byte-identical, and the drift check that recomputes at load agrees with both. The original BOM +
 * line endings survive (shipped content/ is LF/no-BOM, app-written homebrew is CRLF/BOM).
 *
 * Usage: npx tsx tools/restamp.ts <file.csv> [<file.csv> ...]   (or: pnpm restamp <file.csv>)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { restampText } from '../src/lib/content/restamp';
import { parseContentDirectives } from '../src/lib/content/meta';

const TODAY = new Date().toISOString().slice(0, 10);

const files = process.argv.slice(2);
if (files.length === 0) {
	console.error('usage: tsx tools/restamp.ts <file.csv> [<file.csv> ...]');
	process.exit(1);
}

for (const path of files) {
	const raw = readFileSync(path, 'utf8');
	// The guard is "does this look like a content file", NOT "does it already have a hash": a
	// hand-authored CSV that never got stamped is exactly the file that needs stamping, and under the
	// overwrite guard an unstamped file is one the app will never refresh again. (The in-app path has
	// no such guard — there the file came from the loader, so it IS content by construction.)
	if (parseContentDirectives(raw).directives.size === 0) {
		console.error(`✗ ${path}: no #content-* header — not a content file, skipped`);
		continue;
	}
	// a hand-edit is a data change, so the declared revision date moves with the hash
	const out = await restampText(raw, { updated_at: TODAY });
	writeFileSync(path, out);
	console.log(`✓ re-stamped ${path} → ${parseContentDirectives(out).directives.get('hash')}`);
}
