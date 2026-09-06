/*
 * SRD 5.1 (CC-BY-4.0, Tabyltop) → srd-2014/class_casting_srd.csv — the per-level cantrip and
 * spells-known counts every 2014 caster reads its caps from.
 *
 * The numbers live in each class's own progression table, and the tables are structured HTML, so
 * they are read rather than typed. What makes that safe is HOW a column is found: never by trusting
 * a header string, because this source splits "Cantrips Known" across two header rows for four of
 * the seven classes ("Cantrips" above, a bare "Known" below), keeps it whole for the rest, and
 * spells other headers dirty ("4 t h"). So the whole spelling is preferred where it exists — which
 * also skips the warlock table's third Known column, Invocations Known, which is not a spell count —
 * and the split form falls back to position. Every ladder is printed on each run, because a parser
 * that slips one column produces a plausible table and only a human reading it against the book, or
 * the per-class asserts in `class_features_content.test.ts`, will notice.
 *
 * Run: node tools/srd/convert-2014-casting.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { assertCount } from './lib.mjs';
import { packDir } from '../content-repo.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const html = readFileSync(
	resolve(root, 'tools/srd-src/2014/SRD5.1-CCBY4.0License-TT.html'),
	'utf8',
);

const strip = (s) =>
	s
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;?/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

/** Every <table>, reduced to rows of cell text. Each one opens and closes on a single line here. */
const tables = [];
for (const line of html.split('\n')) {
	const m = /<table>[\s\S]*?<\/table>/i.exec(line);
	if (!m) continue;
	tables.push(
		[...m[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) =>
			[...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => strip(c[1])),
		),
	);
}

const LEVEL = /^(\d+)(st|nd|rd|th)$/i;
const squeeze = (c) => c.toLowerCase().replace(/\s+/g, '');

/** The class's own table: the one naming a feature only that class has. Exactly one, or we stop. */
function tableFor(marker) {
	const hits = tables.filter((rows) => rows.some((r) => r.some((c) => c.includes(marker))));
	if (hits.length !== 1)
		throw new Error(`${marker}: matched ${hits.length} tables, want exactly 1`);
	return hits[0];
}

/** One class's ladder. `wants` names the Known columns it carries, in table order. */
function ladder(classId, marker, wants) {
	const rows = tableFor(marker);
	const header = rows.find((r) => /^level$/i.test(r[0] ?? '')) ?? rows[1];
	const whole = wants
		.map((w) =>
			header.findIndex((c) => squeeze(c) === (w === 'cantrips' ? 'cantripsknown' : 'spellsknown')),
		)
		.filter((i) => i >= 0);
	const cols =
		whole.length === wants.length
			? whole
			: header
					.map((c, i) => [c, i])
					.filter(([c]) => /^known$/i.test(c))
					.map(([, i]) => i);
	if (cols.length !== wants.length)
		throw new Error(`${classId}: found ${cols.length} count columns, expected ${wants.length}`);
	const at = Object.fromEntries(wants.map((w, i) => [w, cols[i]]));
	const out = [];
	for (const r of rows) {
		const lvl = LEVEL.exec(r[0] ?? '');
		if (!lvl) continue;
		const cell = (name) =>
			at[name] === undefined ? '' : (r[at[name]] ?? '').replace(/[^\d]/g, '');
		out.push({ level: Number(lvl[1]), cantrips: cell('cantrips'), known: cell('known') });
	}
	assertCount(`${classId} levels`, out.length, 20);
	return out;
}

// marker = text unique to that class's own table; wants = its count columns, in table order.
// Paladin is absent on purpose: 2014 gives it neither cantrips nor a spells-known column.
const CLASSES = [
	['bard', 'Bardic Inspiration', ['cantrips', 'known']],
	['cleric', 'Divine Domain', ['cantrips']],
	['druid', 'Wild Shape', ['cantrips']],
	['sorcerer', 'Sorcerous Origin', ['cantrips', 'known']],
	['warlock', 'Otherworldly Patron', ['cantrips', 'known']],
	['wizard', 'Arcane Recovery', ['cantrips']],
	['ranger', 'Natural Explorer', ['known']],
];

const rows = [];
for (const [classId, marker, wants] of CLASSES) {
	const l = ladder(classId, marker, wants);
	console.log(`  ${classId.padEnd(9)} cantrips: ${l.map((x) => x.cantrips || '-').join(',')}`);
	console.log(`  ${' '.repeat(9)} known:    ${l.map((x) => x.known || '-').join(',')}`);
	for (const x of l)
		rows.push({
			id: `${classId}_${x.level}`,
			class_id: classId,
			level: String(x.level),
			cantrips_known: x.cantrips,
			prepared_known: x.known,
		});
}
assertCount('class_casting rows', rows.length, CLASSES.length * 20);

const header = [
	'#content-source: SRD 5.1',
	'#content-systems: 5e',
	'#content-url: https://dnd.wizards.com/resources/systems-reference-document',
	'#content-license: CC-BY-4.0',
	'#content-schema: 1',
].join('\n');
const csv = Papa.unparse(rows, {
	columns: ['id', 'class_id', 'level', 'cantrips_known', 'prepared_known'],
	newline: '\n',
});
const out = resolve(packDir('srd-2014'), 'class_casting_srd.csv');
writeFileSync(out, `${header}\n${csv}\n`);
console.log(`wrote ${out} — re-stamp it with \`pnpm restamp\``);
