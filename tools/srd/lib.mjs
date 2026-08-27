/* Shared helpers for the SRD markdown → CSV converters. */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import Papa from 'papaparse';
import xxhash from 'xxhash-wasm';

// xxHash inits once (top-level await, ESM) so writeCsv can stay synchronous.
const { h64ToString } = await xxhash();
const SRD_URL = 'https://dnd.wizards.com/resources/systems-reference-document';
const TODAY = new Date().toISOString().slice(0, 10);

/** Time-sortable UUIDv7 (48-bit ms timestamp + random) — the pack's stable identity. */
function uuidv7() {
	const ts = Date.now();
	const b = crypto.getRandomValues(new Uint8Array(16));
	b[0] = (ts / 2 ** 40) & 0xff;
	b[1] = (ts / 2 ** 32) & 0xff;
	b[2] = (ts / 2 ** 24) & 0xff;
	b[3] = (ts / 2 ** 16) & 0xff;
	b[4] = (ts / 2 ** 8) & 0xff;
	b[5] = ts & 0xff;
	b[6] = (b[6] & 0x0f) | 0x70;
	b[8] = (b[8] & 0x3f) | 0x80;
	const h = [...b].map((x) => x.toString(16).padStart(2, '0'));
	return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
}

/** Must match `hashInput` in src/lib/content/hash.ts so the stored hash equals what the app
 *  recomputes at load: the WHOLE file — header included, because `#content-source` is the identity
 *  half of `source:id` — minus the two stamp lines the write itself produces. */
const UNHASHED_DIRECTIVE = /^\s*#\s*content-(hash|updated[_-]at)\s*:/i;
function hashInput(file) {
	const noBom = file.charCodeAt(0) === 0xfeff ? file.slice(1) : file;
	return noBom
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.filter((l) => !UNHASHED_DIRECTIVE.test(l))
		.map((l) => l.replace(/[ \t]+$/, ''))
		.join('\n')
		.replace(/\n+$/, '');
}

// snake_case (E3): `-` is the L2 minus operator, so every content id that could appear in an
// expression (`class_level.blood_hunter`) must avoid `-`; snake also matches the CSV-column style.
export const slug = (s) =>
	s
		.toLowerCase()
		.replace(/['’]/g, '')
		.replace(/\([^)]*\)/g, '') // drop parentheticals e.g. "Magic Initiate (Cleric)"
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');

/**
 * Split markdown into `#### Name` blocks, each tagged with its parent `##` (h2) and
 * `###` (h3) section titles so a converter can keep only entries under the right section.
 */
export function blocks(md) {
	const lines = md.split(/\r?\n/);
	const out = [];
	let h2 = '';
	let h3 = '';
	let cur = null;
	const flush = () => {
		if (cur) out.push(cur);
		cur = null;
	};
	for (const line of lines) {
		let m;
		if ((m = /^##\s+(.+?)\s*$/.exec(line))) {
			flush();
			h2 = m[1];
			h3 = '';
		} else if ((m = /^###\s+(.+?)\s*$/.exec(line))) {
			flush();
			h3 = m[1];
		} else if ((m = /^####\s+(.+?)\s*$/.exec(line))) {
			flush();
			cur = { name: m[1], h2, h3, body: [] };
		} else if (cur) {
			cur.body.push(line);
		}
	}
	flush();
	return out;
}

/** Read a `**Label:** value` field from a block's text. */
export function field(text, label) {
	const m = new RegExp(`^\\*\\*${label}:\\*\\*\\s*(.+?)\\s*$`, 'm').exec(text);
	return m ? m[1].trim() : '';
}

/** Body paragraphs with the `**Field:**` meta lines and blank lines removed. */
export function description(body) {
	return body
		.filter((l) => l.trim() !== '' && !/^\*\*[\w' ]+:\*\*/.test(l))
		.map((l) => l.trim())
		.join('\n');
}

const ABIL = {
	strength: 'str',
	dexterity: 'dex',
	constitution: 'con',
	intelligence: 'int',
	wisdom: 'wis',
	charisma: 'cha',
};
/** "Intelligence, Wisdom, Charisma" / "Strength and Constitution" → "int,wis,cha". */
export function abilities(s) {
	return (
		s.toLowerCase().match(/strength|dexterity|constitution|intelligence|wisdom|charisma/g) || []
	)
		.map((a) => ABIL[a])
		.join(',');
}

/** "Insight and Religion" / "Sleight of Hand and Stealth" → "insight,sleight-of-hand". */
export function skillList(s) {
	return s
		.split(/,|\band\b/)
		.map((x) => slug(x))
		.filter(Boolean)
		.join(',');
}

/**
 * Guarantee unique ids within one file (an exact source:id clash is a real error in our
 * model). On collision, append `_2`, `_3`… deterministically by input order (snake, E3). Rare —
 * e.g. "Spell Scroll" appears both as adventuring gear and as a magic item in SRD 5.2.1.
 */
/**
 * Read `id → <col>` out of an already-written content CSV, so a converter re-run PRESERVES columns
 * that were authored AFTER conversion rather than derived from the SRD prose — effect tokens
 * (conditions, class features, magic items), `expertise_slots`, half-feat ability choices. Without
 * this a raw re-run silently wipes the authoring, which has bitten this repo before. Missing file or
 * blank cell → absent from the map, so the caller's `?? ''` default takes over.
 */
export function existingColById(csvPath, col) {
	if (!existsSync(csvPath)) return new Map();
	const raw = readFileSync(csvPath, 'utf8')
		.replace(/^﻿/, '') // written with a UTF-8 BOM (Excel safety) — strip before the #-filter
		.split('\n')
		.filter((l) => !l.startsWith('#'))
		.join('\n');
	const map = new Map();
	for (const r of Papa.parse(raw, { header: true, skipEmptyLines: true }).data)
		if (r.id && r[col]) map.set(r.id, r[col]);
	return map;
}

export function dedupeIds(rows) {
	const seen = new Set();
	for (const r of rows) {
		let id = r.id;
		for (let n = 2; seen.has(id); n++) id = `${r.id}_${n}`;
		seen.add(id);
		r.id = id;
	}
	return rows;
}

/**
 * Write a content CSV with the `#content-*:` metadata header (DATA-VER-1): `source`/`systems` are
 * hoisted from the row columns into the file-level header and DROPPED from the body, then
 * url/license/id/updated-at/hash are stamped. The body hash matches src/lib/content/hash.ts so the
 * app never sees false drift. (Rows still carry `source`/`systems` when passed in — this is the one
 * place that lifts them out, so no converter needs to change.)
 */
export function writeCsv(path, columns, rows) {
	const sources = [...new Set(rows.map((r) => r.source).filter(Boolean))];
	const systems = [
		...new Set(rows.flatMap((r) => String(r.systems ?? '').split(',')).filter(Boolean)),
	];
	if (sources.length !== 1)
		throw new Error(`${path}: expected exactly one source, got [${sources.join(', ')}]`);

	const bodyCols = columns.filter((c) => c !== 'source' && c !== 'systems');
	const bodyRows = rows.map(({ source: _s, systems: _y, ...rest }) => rest);
	const body = Papa.unparse({ fields: bodyCols, data: bodyRows }, { newline: '\n' }) + '\n';

	// IDEMPOTENT write (the converters commit their output, so a re-run must not churn unchanged
	// files): preserve the existing file's stable `#content-id`, its BOM, and its `updated-at` key
	// spelling; and when the body hash is unchanged, leave the file byte-for-byte alone (no id
	// regen, no date bump). Only real data changes produce a diff.
	let contentId = uuidv7();
	// A pack file is LF and BOM-less (docs/internals/content.md) — BOM + CRLF are for the CSVs the APP
	// writes into the user's data folder, where Excel is the one opening them. The default was the
	// other way round, which is how seven shipped files ended up with a BOM their neighbours lack.
	let hasBom = false;
	let dateKey = 'updated_at';
	let prevHash = null;
	if (existsSync(path)) {
		const prev = readFileSync(path, 'utf8');
		hasBom = prev.charCodeAt(0) === 0xfeff;
		contentId = prev.match(/#content-id:\s*(\S+)/)?.[1] ?? contentId;
		if (/#content-updated-at:/.test(prev)) dateKey = 'updated-at';
		prevHash = prev.match(/#content-hash:\s*(xxh64:\S+)/)?.[1] ?? null;
	}

	// The hash covers these header lines too, so it can only be computed once `#content-id` is
	// settled (preserved from the existing file, or freshly generated). The two stamp lines are the
	// ones it does NOT cover — which is what keeps this write idempotent: re-running on unchanged
	// data yields the same hash even though the date line would say today.
	const hashedHeader = [
		`#content-source: ${sources[0]}`,
		`#content-systems: ${systems.join(',')}`,
		`#content-url: ${SRD_URL}`,
		`#content-license: CC-BY-4.0`, // both SRD 5.1 and 5.2.1 ship under CC-BY-4.0
		`#content-id: ${contentId}`,
	];
	const hash = `xxh64:${h64ToString(hashInput(hashedHeader.join('\n') + '\n' + body))}`;
	if (prevHash === hash) return; // unchanged → don't touch (no id regen, no date bump)

	// the stamp is written FIRST, so verifying a file is "drop the top line and hash the rest"
	const header = [`#content-hash: ${hash}`, ...hashedHeader, `#content-${dateKey}: ${TODAY}`].join(
		'\n',
	);
	writeFileSync(path, (hasBom ? '﻿' : '') + header + '\n' + body, 'utf8');
}

/** Throw if the emitted row count doesn't match what the source contains. */
export function assertCount(label, got, expected) {
	const ok = got === expected;
	console.log(
		`${ok ? '✓' : '✗'} ${label}: ${got}${expected != null ? ` (expected ${expected})` : ''}`,
	);
	if (!ok) throw new Error(`${label}: emitted ${got} rows but source has ${expected}`);
}
