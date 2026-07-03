/*
 * SRD 5.2.1 (CC-BY-4.0) class Features tables → spell_slots + class_casting CSVs.
 * Source: tools/srd-src/2024/classes.md (the same document the other converters use).
 *
 * Parses each caster class's Features table (real SRD numbers — NOT hand-typed):
 *  - the "Spell Slots per Spell Level" matrix (or Warlock's "Spell Slots" + "Slot Level"),
 *  - the "Cantrips" and "Prepared Spells"/"Spells Known" columns.
 * Emits ONE `spell_slots` table per kind (full/half/pact) after asserting every class of a
 * kind yields an identical matrix, and one `class_casting` row per class per level.
 * Run: node tools/srd/convert-slots.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCsv, assertCount } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const md = readFileSync(resolve(root, 'tools/srd-src/2024/classes.md'), 'utf8');
const out = (f) => resolve(root, 'content/srd-2024', f);

const SYSTEMS = '5.5e';
const SOURCE = 'SRD 5.2.1';
/** caster class → slot-table kind. Non-casters are absent (no Features spell table). */
const KIND = {
	bard: 'full',
	cleric: 'full',
	druid: 'full',
	sorcerer: 'full',
	wizard: 'full',
	paladin: 'half',
	ranger: 'half',
	warlock: 'pact'
};

const strip = (s) =>
	s
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
/** A slot / count cell → number ("—", "-", "" → 0). */
const num = (s) => {
	const t = strip(s);
	return /^\d+$/.test(t) ? Number(t) : 0;
};

/** Split classes.md into `## <ClassName>` sections (h2 only, not ###/####). */
function classSections() {
	const lines = md.split(/\r?\n/);
	const sections = {};
	let cur = null;
	for (const line of lines) {
		const m = /^## ([^#].*?)\s*$/.exec(line);
		if (m) {
			const id = m[1].toLowerCase().trim();
			cur = KIND[id] ? (sections[id] = []) : null;
		} else if (cur) {
			cur.push(line);
		}
	}
	return sections;
}

/** The class Features table = the first <table> carrying spell-slot columns. */
function featuresTable(sectionText) {
	const tables = sectionText.match(/<table>[\s\S]*?<\/table>/g) ?? [];
	return tables.find((t) => /Spell Slots per Spell Level|Slot Level/.test(t)) ?? null;
}

/** Cells of one <tr> as { text, colspan }. */
function cells(tr) {
	const out = [];
	const re = /<t[hd]([^>]*)>([\s\S]*?)<\/t[hd]>/g;
	let m;
	while ((m = re.exec(tr))) {
		const cs = /colspan="?(\d+)"?/.exec(m[1]);
		out.push({ text: strip(m[2]), colspan: cs ? Number(cs[1]) : 1 });
	}
	return out;
}

/** Parse a Features table into { levels: [{level, cantrips, prepared, slots{1..9}}], pact }. */
function parseTable(table) {
	const thead = /<thead>([\s\S]*?)<\/thead>/.exec(table)?.[1] ?? '';
	const tbody = /<tbody>([\s\S]*?)<\/tbody>/.exec(table)?.[1] ?? table;
	const headRows = (thead.match(/<tr>[\s\S]*?<\/tr>/g) ?? []).map(cells);
	const row1 = headRows[0] ?? [];
	const row2 = headRows[1];

	// leaf column labels: simple columns keep their row1 name; a colspan group takes its
	// leaves' names from row2's digit labels.
	const labels = [];
	if (row2 && row1.some((c) => c.colspan > 1)) {
		let p = 0;
		for (const c of row1) {
			if (c.colspan === 1) labels[p++] = c.text;
			else for (let k = 0; k < c.colspan; k++, p++) labels[p] = row2[p]?.text ?? '';
		}
	} else {
		row1.forEach((c, i) => (labels[i] = c.text));
	}

	const idxOf = (name) => labels.findIndex((l) => l === name);
	const levelCol = idxOf('Level');
	const cantripCol = idxOf('Cantrips');
	const prepCol = idxOf('Prepared Spells') >= 0 ? idxOf('Prepared Spells') : idxOf('Spells Known');
	const pact = idxOf('Slot Level') >= 0;
	const slotSlots = pact ? idxOf('Spell Slots') : -1;
	const slotLevel = pact ? idxOf('Slot Level') : -1;
	const slotCols = {}; // spell level → column index (standard matrix)
	if (!pact) for (let d = 1; d <= 9; d++) slotCols[d] = idxOf(String(d));

	const rows = tbody.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
	const levels = [];
	for (const tr of rows) {
		const c = cells(tr).map((x) => x.text);
		const level = Number(strip(c[levelCol] ?? ''));
		if (!(level >= 1 && level <= 20)) continue;
		const slots = {};
		for (let d = 1; d <= 9; d++) slots[d] = 0;
		if (pact) {
			const n = num(c[slotSlots]);
			const lv = num(c[slotLevel]);
			if (lv >= 1 && lv <= 9) slots[lv] = n;
		} else {
			for (let d = 1; d <= 9; d++) slots[d] = slotCols[d] >= 0 ? num(c[slotCols[d]]) : 0;
		}
		levels.push({
			level,
			cantrips: cantripCol >= 0 ? num(c[cantripCol]) : '',
			prepared: prepCol >= 0 ? num(c[prepCol]) : '',
			slots
		});
	}
	return { levels, pact };
}

// --- parse every caster class ------------------------------------------------
const sections = classSections();
const parsed = {}; // classId → {levels, pact}
for (const [id, text] of Object.entries(sections))
	parsed[id] = parseTable(featuresTable(text.join('\n')));
assertCount('caster classes found', Object.keys(parsed).length, Object.keys(KIND).length);

// --- spell_slots: one table per kind (assert every class of a kind matches) --
const SLOT_COLS = [
	'slot_1',
	'slot_2',
	'slot_3',
	'slot_4',
	'slot_5',
	'slot_6',
	'slot_7',
	'slot_8',
	'slot_9'
];
const matrixKey = (levels) =>
	JSON.stringify(
		levels.map((l) => [l.level, ...Array.from({ length: 9 }, (_, i) => l.slots[i + 1])])
	);

const kinds = {}; // kind → representative levels
for (const [id, kind] of Object.entries(KIND)) {
	const key = matrixKey(parsed[id].levels);
	if (!kinds[kind]) kinds[kind] = { levels: parsed[id].levels, key, from: id };
	else if (kinds[kind].key !== key)
		throw new Error(`${id} slot matrix differs from ${kinds[kind].from} (kind ${kind})`);
}

const slotRows = [];
for (const [kind, { levels }] of Object.entries(kinds))
	for (const l of levels) {
		const row = {
			id: `${kind}-${l.level}`,
			systems: SYSTEMS,
			source: SOURCE,
			kind,
			level: l.level
		};
		for (let d = 1; d <= 9; d++) row[SLOT_COLS[d - 1]] = l.slots[d];
		slotRows.push(row);
	}
writeCsv(
	out('spell_slots_srd.csv'),
	['id', 'systems', 'source', 'kind', 'level', ...SLOT_COLS],
	slotRows
);
assertCount('spell_slots', slotRows.length, Object.keys(kinds).length * 20);

// --- class_casting: cantrips / prepared-known per class per level ------------
const castRows = [];
for (const [id, { levels }] of Object.entries(parsed))
	for (const l of levels)
		castRows.push({
			id: `${id}-${l.level}`,
			systems: SYSTEMS,
			source: SOURCE,
			class_id: id,
			level: l.level,
			cantrips_known: l.cantrips,
			prepared_known: l.prepared
		});
writeCsv(
	out('class_casting_srd.csv'),
	['id', 'systems', 'source', 'class_id', 'level', 'cantrips_known', 'prepared_known'],
	castRows
);
assertCount('class_casting', castRows.length, Object.keys(KIND).length * 20);

console.log('done.', `kinds=${Object.keys(kinds).join('/')}`);
