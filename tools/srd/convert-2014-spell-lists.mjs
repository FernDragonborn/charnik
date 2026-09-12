/*
 * SRD 5.1 "Spell Lists" → the `classes` column of srd-2014/spells_srd.csv.
 *
 * Reads the CC-BY-4.0 SRD 5.1 HTML (tools/srd-src/2014/SRD5.1-CCBY4.0License-TT.html) and fills in
 * WHICH classes can cast each 2014 spell. The 2014 pack shipped that column empty, which left every
 * 2014 class with an empty Strict spell pool — a caster that could not be created.
 *
 * This converter PATCHES one column of the existing CSV rather than regenerating it: the pack has
 * moved on since the last full run of convert-2014.mjs, and re-emitting every row to fix one column is
 * how unrelated hand-edits get reverted (docs/internals/tooling.md).
 *
 * Fidelity notes — both are the SOURCE's own shape, not a guess:
 *   - The Bard section's "1st Level" and "2nd Level" headings are missing from the document; its
 *     2nd-level spells are listed under the cantrip heading and its 1st-level ones are absent
 *     altogether. Level headings are IGNORED here (a spell's level is its own row's column), so only
 *     the absent names are lost, and the run REPORTS that gap rather than inventing a list.
 *   - A name the spells file does not carry is reported and skipped, never slugged into a dangling id.
 *
 * Run: node tools/srd/convert-2014-spell-lists.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { packDir } from '../content-repo.mjs';
import { slug, writeCsv } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const SRC = resolve(root, 'tools/srd-src/2014/SRD5.1-CCBY4.0License-TT.html');
const OUT = resolve(packDir('srd-2014'), 'spells_srd.csv');

/** The `<h3>Xxx Spells</h3>` … `<p>Spell Name</p>` blocks of the Spell Lists section. */
function classLists(html) {
	const start = html.indexOf("id='SpellLists'");
	if (start < 0) throw new Error('no Spell Lists section in the SRD source');
	const section = html.slice(start, html.indexOf('<h2', start + 10));
	const lists = new Map();
	let current = null;
	const token = /<h3 [^>]*>.*?<b>(.*?)<\/b>|<p>(.*?)<\/p>/gs;
	for (const [, heading, entry] of section.matchAll(token)) {
		if (heading !== undefined) {
			current = slug(
				heading
					.replace(/\s+/g, ' ')
					.trim()
					.replace(/ Spells$/, ''),
			);
			lists.set(current, []);
		} else if (current && entry.trim()) {
			lists.get(current).push(entry.replace(/\s+/g, ' ').trim());
		}
	}
	return lists;
}

const lists = classLists(readFileSync(SRC, 'utf8'));

const raw = readFileSync(OUT, 'utf8');
const directive = (name) => raw.match(new RegExp(`#content-${name}:\\s*(.+)`))?.[1].trim();
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

/** Every spell the file knows, keyed by its name with punctuation and spacing removed — the shape the
 *  list entries have to be matched in, because the source's own typography cannot be trusted: some
 *  paragraphs run several names together ("Planar Binding Raise Dead Scrying") and some lose the space
 *  inside one ("CharmPerson"). */
const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const byName = new Map(rows.map((r) => [squash(r.name_en || r.id), r.id]));
const longestFirst = [...byName.keys()].sort((a, b) => b.length - a.length);

/** One list paragraph → the spell ids in it. Longest-match segmentation, so a run-together paragraph
 *  yields its several spells and an unknown name yields nothing but a report. */
function idsIn(entry) {
	let rest = squash(entry);
	const ids = [];
	while (rest) {
		const hit = longestFirst.find((name) => rest.startsWith(name));
		if (!hit) return { ids, leftover: rest };
		ids.push(byName.get(hit));
		rest = rest.slice(hit.length);
	}
	return { ids, leftover: '' };
}

/** class id → the spell ids it casts; plus every list name no spell row answers to. */
const unmatched = [];
const perClass = new Map();
for (const [classId, names] of lists) {
	const ids = [];
	for (const name of names) {
		const got = idsIn(name);
		ids.push(...got.ids);
		if (got.leftover) unmatched.push(`${classId}: ${name} (unresolved: ${got.leftover})`);
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
// the source's own gap, printed every run so it can never become an invisible assumption
if (!perClass.get('bard')?.some((id) => Number(byId.get(id).level) === 1))
	console.log('NOTE: the source lists no 1st-level Bard spells (its headings are missing there)');
if (unmatched.length) console.log(`unmatched names (skipped):\n  ${unmatched.join('\n  ')}`);
if (tagged < 200) throw new Error(`only ${tagged} rows tagged — the source parse is wrong`);

writeCsv(
	OUT,
	['source', 'systems', ...parsed.meta.fields],
	rows.map((r) => ({ ...r, source, systems })),
);
