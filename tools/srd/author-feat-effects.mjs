/*
 * One-off authoring pass: stamp curated `effects` tokens onto SRD feat rows whose mechanic maps
 * CLEANLY onto the bounded vocab. Preserved across converter re-runs (convert.mjs). Idempotent.
 *
 * Scope note: most SRD feats DON'T map — spell grants (Magic Initiate), once-per-turn rerolls
 * (Savage Attacker / Great Weapon Fighting), weapon-type-conditional bonuses (Archery), and
 * half-feat ability CHOICES (Grappler) need mechanics/UI the vocab lacks; those stay as text (the
 * engine already surfaces them). Only unconditional, faithfully-encodable effects are stamped here.
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
	'category',
	'prereq',
	'repeatable'
];

const EFFECTS = {
	'content/srd-2024': {
		// Alert (2024) · Initiative Proficiency: add your Proficiency Bonus to Initiative rolls.
		// (Its Initiative Swap benefit isn't vocab-representable → stays as text.)
		alert: 'flat_bonus:initiative+proficiency_bonus'
	}
};

for (const [dir, effects] of Object.entries(EFFECTS)) {
	const path = resolve(root, dir, 'feats_srd.csv');
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
		effects: effects[r.id] ?? r.effects ?? ''
	}));
	writeCsv(path, COLUMNS, rows);
	const applied = Object.keys(effects).filter((id) => rows.some((r) => r.id === id));
	console.log(`${dir}: ${applied.join(', ') || 'none'}`);
	for (const id of Object.keys(effects))
		if (!rows.some((r) => r.id === id)) console.warn(`  ⚠ ${id} NOT FOUND`);
}
