/* Shared helpers for the SRD markdown → CSV converters. */
import { writeFileSync } from 'node:fs';
import Papa from 'papaparse';

export const slug = (s) =>
	s
		.toLowerCase()
		.replace(/['’]/g, '')
		.replace(/\([^)]*\)/g, '') // drop parentheticals e.g. "Magic Initiate (Cleric)"
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

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
 * model). On collision, append `-2`, `-3`… deterministically by input order. Rare —
 * e.g. "Spell Scroll" appears both as adventuring gear and as a magic item in SRD 5.2.1.
 */
export function dedupeIds(rows) {
	const seen = new Set();
	for (const r of rows) {
		let id = r.id;
		for (let n = 2; seen.has(id); n++) id = `${r.id}-${n}`;
		seen.add(id);
		r.id = id;
	}
	return rows;
}

export function writeCsv(path, columns, rows) {
	const csv = Papa.unparse({ fields: columns, data: rows }, { newline: '\n' });
	writeFileSync(path, csv + '\n', 'utf8');
}

/** Throw if the emitted row count doesn't match what the source contains. */
export function assertCount(label, got, expected) {
	const ok = got === expected;
	console.log(
		`${ok ? '✓' : '✗'} ${label}: ${got}${expected != null ? ` (expected ${expected})` : ''}`
	);
	if (!ok) throw new Error(`${label}: emitted ${got} rows but source has ${expected}`);
}
