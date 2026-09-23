/*
 * SRD 5.1 "Spell Lists" → the `classes` column of srd-2014/spells_srd.csv.
 *
 * Reads the OFFICIAL CC-BY-4.0 SRD 5.1 PDF (tools/srd-src/2014/SRD_CC_v5.1.pdf) and fills in WHICH
 * classes can cast each 2014 spell. The 2014 pack shipped that column empty, which left every 2014
 * class with an empty Strict spell pool — a caster that could not be created.
 *
 * **It reads the PDF and not the Tabyltop HTML every other 2014 converter reads.** The SRD prints
 * these lists in several columns per page, and that conversion keeps only some of them: 551 of the
 * document's 778 entries survive it, which cost the Bard its whole 1st-level block (that is where the
 * "the SRD lost its headings" reading came from — the document has them) and cost the Wizard 51
 * spells. The PDF's own text layer has all of it, and what it names is exactly the 319 spells this
 * pack ships — so the parse is asserted against that correspondence rather than against a count
 * somebody wrote down.
 *
 * This converter PATCHES one column of the existing CSV rather than regenerating it: the pack has
 * moved on since the last full run of convert-2014.mjs, and re-emitting every row to fix one column is
 * how unrelated hand-edits get reverted (docs/internals/tooling.md).
 *
 * Run: node tools/srd/convert-2014-spell-lists.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { packDir } from '../content-repo.mjs';
import { writeCsv } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const SRC = resolve(root, 'tools/srd-src/2014/SRD_CC_v5.1.pdf');
const OUT = resolve(packDir('srd-2014'), 'spells_srd.csv');

const CLASS_HEADING = /^(Bard|Cleric|Druid|Paladin|Ranger|Sorcerer|Warlock|Wizard) Spells$/;
const LEVEL_HEADING = /^(Cantrips \(0 Level\)|[1-9](?:st|nd|rd|th) Level)$/;
/** Running heads sit in the same text layer as the lists, and carry the page number on their own
 *  line ("System Reference Document 5.1 106"). */
const PAGE_FURNITURE = /^(System\s*Reference\s*Document\s*5\.1(\s+\d+)?|\d+)$/;

/** The document's text, one line per line, with the furniture dropped. */
async function pdfLines(file) {
	const doc = await pdfjs.getDocument({
		data: new Uint8Array(readFileSync(file)),
		useSystemFonts: true,
	}).promise;
	const out = [];
	for (let page = 1; page <= doc.numPages; page++) {
		const content = await (await doc.getPage(page)).getTextContent();
		const text = content.items.map((i) => (i.hasEOL ? `${i.str}\n` : i.str)).join('');
		for (const line of text.split('\n')) {
			const clean = line.replace(/\s+/g, ' ').trim();
			if (clean && !PAGE_FURNITURE.test(clean)) out.push(clean);
		}
	}
	return out;
}

/** The heading that follows the Spell Lists section — where it ends. */
const SECTION_END = 'Spell Descriptions';

/** The Spell Lists section → class id → the spell NAMES it lists. Level headings are read only to
 *  know a heading from a spell: a spell's level is its own row's column, never this document's. */
function classLists(lines) {
	const start = lines.indexOf('Spell Lists');
	if (start < 0) throw new Error('no Spell Lists section in the SRD source');
	const lists = new Map();
	let current = null;
	for (const line of lines.slice(start + 1)) {
		const heading = CLASS_HEADING.exec(line);
		if (heading) {
			current = heading[1].toLowerCase();
			lists.set(current, []);
		} else if (LEVEL_HEADING.test(line)) {
			if (!current) throw new Error(`level heading before any class: ${line}`);
		} else if (line === SECTION_END) {
			break;
		} else if (current) {
			lists.get(current).push(line);
		}
	}
	return lists;
}

const lists = classLists(await pdfLines(SRC));

const raw = readFileSync(OUT, 'utf8');
const directive = (name) => raw.match(new RegExp(`#content-${name}:\s*(.+)`))?.[1].trim();
const source = directive('source');
const systems = directive('systems');
if (!source || !systems) throw new Error(`${OUT}: no #content-source/#content-systems header`);
const parsed = Papa.parse(
	raw
		.split('\n')
		.filter((l) => !l.startsWith('#'))
		.join('\n')
		.trim(),
	{ header: true, skipEmptyLines: true },
);
const rows = parsed.data;
const byId = new Map(rows.map((r) => [r.id, r]));

/** Every spell the file knows, keyed by its name with punctuation and spacing removed — the shape a
 *  list entry has to be matched in, because the source's own typography cannot be trusted ("See I
 *  nvisibility" is how SRD 5.1 prints it). */
const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const byName = new Map(rows.map((r) => [squash(r.name_en || r.id), r.id]));

const unmatched = [];
const perClass = new Map();
for (const [classId, names] of lists) {
	const ids = [];
	for (const name of names) {
		const id = byName.get(squash(name));
		if (id) ids.push(id);
		else unmatched.push(`${classId}: ${name}`);
	}
	perClass.set(classId, [...new Set(ids)]);
}

for (const row of rows) row.classes = '';
for (const [classId, ids] of perClass)
	for (const id of ids) {
		const row = byId.get(id);
		row.classes = row.classes ? `${row.classes},${classId}` : classId;
	}

const tagged = rows.filter((r) => r.classes).length;
console.log(`spell lists: ${[...perClass].map(([c, ids]) => `${c} ${ids.length}`).join(', ')}`);
console.log(`${tagged}/${rows.length} spell rows carry a class`);
if (unmatched.length) console.log(`unmatched names (skipped):\n  ${unmatched.join('\n  ')}`);
// The assertion that matters: the SRD's lists name every spell the SRD describes, so a spell row with
// no class means the parse dropped a column — which is exactly the failure this rewrite is about.
if (unmatched.length) throw new Error(`${unmatched.length} list names matched no spell row`);
if (tagged !== rows.length)
	throw new Error(
		`${rows.length - tagged} spell rows carry no class — the source parse lost entries`,
	);

writeCsv(
	OUT,
	['source', 'systems', ...parsed.meta.fields],
	rows.map((r) => ({ ...r, source, systems })),
);
