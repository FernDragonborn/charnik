/*
 * One-off authoring pass (N4a): stamp curated `expertise_slots` (`level:count` grants) onto the SRD
 * Expertise feature rows. Values are RAW SRD facts (Rogue L1+L6, Bard L3/L10 (2014) / L2/L9 (2024),
 * 2024 Ranger L9) curated into a bounded annotation — the same authored-then-preserved pattern as the
 * `effects` tokens; convert-classes.mjs / convert-2014.mjs preserve the column on re-run. Idempotent.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { writeCsv } from './lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const COLUMNS = [
	'id',
	'systems',
	'source',
	'name_en',
	'name_uk',
	'text_en',
	'text_uk',
	'effects',
	'class_id',
	'level',
	'resource',
	'subclass_id',
	'expertise_slots'
];

// id → level:count spec, per edition dir
const GRANTS = {
	'content/srd-2024': {
		rogue_expertise: '1:2,6:2',
		bard_expertise: '2:2,9:2', // 2024: Expertise at Bard 2, +2 at Bard 9
		ranger_expertise: '9:2' // 2024 Ranger gains Expertise at level 9
	},
	'content/srd-2014': {
		rogue_expertise: '1:2,6:2',
		bard_expertise: '3:2,10:2'
	}
};

for (const [dir, grants] of Object.entries(GRANTS)) {
	const path = resolve(root, dir, 'class_features_srd.csv');
	const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
	const source = text.match(/#content-source:\s*(.+)/)?.[1].trim();
	const systems = text.match(/#content-systems:\s*(.+)/)?.[1].trim();
	const body = text
		.split('\n')
		.filter((l) => !l.startsWith('#'))
		.join('\n');
	const rows = Papa.parse(body, { header: true, skipEmptyLines: true }).data.map((r) => ({
		...r,
		source,
		systems,
		expertise_slots: grants[r.id] ?? r.expertise_slots ?? ''
	}));
	const applied = rows.filter((r) => r.expertise_slots).map((r) => `${r.id}=${r.expertise_slots}`);
	writeCsv(path, COLUMNS, rows);
	console.log(`${dir}: ${applied.length ? applied.join(', ') : 'no grants'}`);
	for (const id of Object.keys(grants))
		if (!rows.some((r) => r.id === id)) console.warn(`  ⚠ ${id} NOT FOUND in ${dir}`);
}
