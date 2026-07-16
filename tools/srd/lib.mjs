/* Shared helpers for the SRD markdown → CSV converters. */
import { writeFileSync } from 'node:fs';
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

/** Must match src/lib/content/hash.ts so the stored hash equals what the app recomputes at load. */
function normalizeBody(body) {
	const noBom = body.charCodeAt(0) === 0xfeff ? body.slice(1) : body;
	return noBom
		.replace(/\r\n?/g, '\n')
		.split('\n')
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
	charisma: 'cha'
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
		...new Set(rows.flatMap((r) => String(r.systems ?? '').split(',')).filter(Boolean))
	];
	if (sources.length !== 1)
		throw new Error(`${path}: expected exactly one source, got [${sources.join(', ')}]`);

	const bodyCols = columns.filter((c) => c !== 'source' && c !== 'systems');
	const bodyRows = rows.map(({ source: _s, systems: _y, ...rest }) => rest);
	const body = Papa.unparse({ fields: bodyCols, data: bodyRows }, { newline: '\n' }) + '\n';

	const header = [
		`#content-source: ${sources[0]}`,
		`#content-systems: ${systems.join(',')}`,
		`#content-url: ${SRD_URL}`,
		`#content-license: CC-BY-4.0`, // both SRD 5.1 and 5.2.1 ship under CC-BY-4.0
		`#content-id: ${uuidv7()}`,
		`#content-updated-at: ${TODAY}`,
		`#content-hash: xxh64:${h64ToString(normalizeBody(body))}`
	].join('\n');
	writeFileSync(path, header + '\n' + body, 'utf8');
}

/** Throw if the emitted row count doesn't match what the source contains. */
export function assertCount(label, got, expected) {
	const ok = got === expected;
	console.log(
		`${ok ? '✓' : '✗'} ${label}: ${got}${expected != null ? ` (expected ${expected})` : ''}`
	);
	if (!ok) throw new Error(`${label}: emitted ${got} rows but source has ${expected}`);
}
