/*
 * Re-stamp a content CSV's `#content-hash` (+ `updated_at`) after a HAND-EDIT — in place, WITHOUT
 * regenerating rows. Use this instead of re-running a converter when you've edited a content CSV by
 * hand (e.g. added an effect token to a feat): a converter re-run can churn UNRELATED files (it drops
 * `conditions_srd.csv`'s `max_level` column — a stale-converter bug), whereas this touches only the
 * two hash/date directive lines of the files you name.
 *
 * It reuses the APP's own `hashFile` (src/lib/content/hash.ts) so the stamp always matches what the
 * content-health drift check recomputes at load. The original BOM + line endings are preserved
 * byte-for-byte (shipped content/ is LF/no-BOM; app-written homebrew is CRLF/BOM) — only the
 * `#content-hash:` and `#content-updated_at:` lines change, and the hash line MOVES to the top
 * (that is where every writer puts it now, so verifying is "drop the first line").
 *
 * Usage: npx tsx tools/restamp.ts <file.csv> [<file.csv> ...]   (or: pnpm restamp <file.csv>)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { hashFile } from '../src/lib/content/hash';

const TODAY = new Date().toISOString().slice(0, 10);
const BOM = '﻿';

const files = process.argv.slice(2);
if (files.length === 0) {
	console.error('usage: tsx tools/restamp.ts <file.csv> [<file.csv> ...]');
	process.exit(1);
}

for (const path of files) {
	const raw = readFileSync(path, 'utf8');
	// `hashFile` ignores the hash + date lines wherever they sit, so the stamp still on the file
	// (and the date about to be bumped) can't affect what we compute.
	const hash = await hashFile(raw);
	const eol = raw.includes('\r\n') ? '\r\n' : '\n';
	const hasBom = raw.charCodeAt(0) === 0xfeff;
	const kept = (hasBom ? raw.slice(1) : raw)
		.split(/\r?\n/)
		.filter((line) => !line.startsWith('#content-hash:')) // dropped here, re-emitted at the top
		.map((line) => {
			if (line.startsWith('#content-updated_at:')) return `#content-updated_at: ${TODAY}`;
			if (line.startsWith('#content-updated-at:')) return `#content-updated-at: ${TODAY}`; // legacy kebab
			return line;
		});
	// The guard is "does this look like a content file", NOT "does it already have a hash": a
	// hand-authored CSV that never got stamped is exactly the file that needs stamping, and under the
	// overwrite guard an unstamped file is one the app will never refresh again.
	if (!kept.some((line) => line.startsWith('#content-'))) {
		console.error(`✗ ${path}: no #content-* header — not a content file, skipped`);
		continue;
	}
	writeFileSync(path, (hasBom ? BOM : '') + [`#content-hash: ${hash}`, ...kept].join(eol));
	console.log(`✓ re-stamped ${path} → ${hash}`);
}
