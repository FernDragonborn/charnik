/*
 * Re-stamp a content CSV's `#content-hash` (+ `updated_at`) after a HAND-EDIT — in place, WITHOUT
 * regenerating rows. Use this instead of re-running a converter when you've edited a content CSV by
 * hand (e.g. added an effect token to a feat): a converter re-run can churn UNRELATED files (it drops
 * `conditions_srd.csv`'s `max_level` column — a stale-converter bug), whereas this touches only the
 * two hash/date directive lines of the files you name.
 *
 * It reuses the APP's own `hashBody` (src/lib/content/hash.ts) so the stamp always matches what the
 * content-health drift check recomputes at load. The original BOM + line endings are preserved
 * byte-for-byte (shipped content/ is LF/no-BOM; app-written homebrew is CRLF/BOM) — only the
 * `#content-hash:` and `#content-updated_at:` lines change.
 *
 * Usage: npx tsx tools/restamp.ts <file.csv> [<file.csv> ...]   (or: pnpm restamp <file.csv>)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { hashBody } from '../src/lib/content/hash';

const TODAY = new Date().toISOString().slice(0, 10);

const files = process.argv.slice(2);
if (files.length === 0) {
	console.error('usage: tsx tools/restamp.ts <file.csv> [<file.csv> ...]');
	process.exit(1);
}

for (const path of files) {
	const raw = readFileSync(path, 'utf8');
	const hash = await hashBody(raw); // the app's exact normalisation → the stamp can't drift
	const eol = raw.includes('\r\n') ? '\r\n' : '\n';
	let stampedHash = false;
	const out = raw.split(/\r?\n/).map((line) => {
		if (line.startsWith('#content-hash:')) {
			stampedHash = true;
			return `#content-hash: ${hash}`;
		}
		if (line.startsWith('#content-updated_at:')) return `#content-updated_at: ${TODAY}`;
		if (line.startsWith('#content-updated-at:')) return `#content-updated-at: ${TODAY}`; // legacy kebab
		return line;
	});
	if (!stampedHash) {
		console.error(`✗ ${path}: no #content-hash directive — not a stamped content file, skipped`);
		continue;
	}
	writeFileSync(path, out.join(eol));
	console.log(`✓ re-stamped ${path} → ${hash}`);
}
