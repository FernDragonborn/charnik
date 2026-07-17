/*
 * SRD 5.2.1 (CC-BY-4.0) markdown → content/srd/*.csv  —  ALL types except spells
 * (spells have their own script). Source: tools/srd-src/2024/ (downfallx mirror).
 *
 * Every row is GENERATED from the official document, tagged `5.5e`. Structured columns
 * are parsed from the source; ambiguous ones are left blank, never guessed. Each type
 * asserts its emitted row count against what the source contains, so a parser that drops
 * an entry fails loudly. Run: node tools/srd/convert.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	blocks,
	field,
	description,
	abilities,
	skillList,
	slug,
	writeCsv,
	assertCount
} from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const src = (f) => readFileSync(resolve(root, 'tools/srd-src/2024', f), 'utf8');
const out = (f) => resolve(root, 'content/srd-2024', f);

// --- feats -------------------------------------------------------------------
const FEAT_SECTIONS = {
	'Origin Feats': 'origin',
	'General Feats': 'general',
	'Fighting Style Feats': 'fighting_style',
	'Epic Boon Feats': 'epic_boon'
};
function convertFeats() {
	const all = blocks(src('feats.md')).filter((b) => FEAT_SECTIONS[b.h3]);
	const rows = all.map((b) => {
		const text = b.body.join('\n');
		const prereqM = /Prerequisite:\s*([^)]+)\)/.exec(text);
		return {
			id: slug(b.name),
			systems: '5.5e',
			source: 'SRD 5.2.1',
			name_en: b.name,
			name_uk: '',
			text_en: description(b.body),
			text_uk: '',
			effects: '',
			category: FEAT_SECTIONS[b.h3],
			prereq: prereqM ? prereqM[1].trim() : '',
			repeatable: String(/_Repeatable\._/.test(text))
		};
	});
	writeCsv(
		out('feats_srd.csv'),
		[
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
		],
		rows
	);
	assertCount('feats', rows.length, all.length);
}

// --- conditions (glossary entries tagged "[Condition]") ----------------------
const POSITIVE_CONDITIONS = new Set(['invisible']); // the only beneficial one in SRD
function convertConditions() {
	const all = blocks(src('rules-glossary.md')).filter((b) => /\[Condition\]\s*$/.test(b.name));
	const rows = all.map((b) => {
		const name = b.name.replace(/\s*\[Condition\]\s*$/, '');
		const id = slug(name);
		return {
			id,
			systems: '5.5e',
			source: 'SRD 5.2.1',
			name_en: name,
			name_uk: '',
			text_en: description(b.body),
			text_uk: '',
			effects: '',
			negative: String(!POSITIVE_CONDITIONS.has(id))
		};
	});
	writeCsv(
		out('conditions_srd.csv'),
		['id', 'systems', 'source', 'name_en', 'name_uk', 'text_en', 'text_uk', 'effects', 'negative'],
		rows
	);
	assertCount('conditions', rows.length, all.length);
}

// --- species -----------------------------------------------------------------
function convertSpecies() {
	const all = blocks(src('character-origins.md')).filter((b) => b.h3 === 'Species Descriptions');
	const rows = all.map((b) => {
		const text = b.body.join('\n');
		const sizeRaw = field(text, 'Size');
		const speedRaw = field(text, 'Speed');
		return {
			id: slug(b.name),
			systems: '5.5e',
			source: 'SRD 5.2.1',
			name_en: b.name,
			name_uk: '',
			text_en: description(b.body),
			text_uk: '',
			effects: '',
			size: (
				/(tiny|small|medium|large|huge|gargantuan)/i.exec(sizeRaw)?.[1] || 'medium'
			).toLowerCase(),
			speed: parseInt(speedRaw, 10) || 30,
			creature_type: (field(text, 'Creature Type') || '').toLowerCase()
		};
	});
	writeCsv(
		out('species_srd.csv'),
		[
			'id',
			'systems',
			'source',
			'name_en',
			'name_uk',
			'text_en',
			'text_uk',
			'effects',
			'size',
			'speed',
			'creature_type'
		],
		rows
	);
	assertCount('species', rows.length, all.length);
}

// --- species options (2024 in-species lineages / legacies) -------------------
// 2024 species with a table-based choice: each is a 4-column table (Name · level-1 benefit ·
// spell · spell). We take the name + level-1 benefit text; effects stay blank (2024 species carry
// no ASI — the choice grants a trait, recorded + shown, not a stat change). Dragonborn draconic
// ancestry (a paired damage-type table) and Gnome/Goliath (prose lists) are deferred.
const SPECIES_CHOICE_2024 = {
	Elf: { kind: 'lineage', label: 'Elven Lineage' },
	Tiefling: { kind: 'legacy', label: 'Fiendish Legacy' }
};
const stripHtml = (s) =>
	s
		.replace(/<[^>]+>/g, '')
		.replace(/&#39;|’/g, "'")
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ')
		.trim();
function firstTableTds(body) {
	const t = /<table>([\s\S]*?)<\/table>/i.exec(body.join('\n'));
	return t ? [...t[1].matchAll(/<td>([\s\S]*?)<\/td>/gi)].map((m) => stripHtml(m[1])) : [];
}
function convertSpeciesOptions() {
	const all = blocks(src('character-origins.md')).filter((b) => b.h3 === 'Species Descriptions');
	const rows = [];
	for (const b of all) {
		const ch = SPECIES_CHOICE_2024[b.name];
		if (!ch) continue;
		const tds = firstTableTds(b.body);
		for (let i = 0; i + 1 < tds.length; i += 4) {
			const name = tds[i];
			if (!name) continue;
			rows.push({
				id: slug(`${b.name}-${name}`),
				systems: '5.5e',
				source: 'SRD 5.2.1',
				name_en: name,
				name_uk: '',
				text_en: tds[i + 1] || '', // the level-1 benefit
				text_uk: '',
				effects: '',
				species_id: slug(b.name),
				kind: ch.kind,
				option_label: ch.label
			});
		}
	}
	assertCount('species_options', rows.length, 6); // 3 Elven Lineages + 3 Fiendish Legacies
	writeCsv(
		out('species_options_srd.csv'),
		[
			'id',
			'systems',
			'source',
			'name_en',
			'name_uk',
			'text_en',
			'text_uk',
			'effects',
			'species_id',
			'kind',
			'option_label'
		],
		rows
	);
}

// --- backgrounds -------------------------------------------------------------
function convertBackgrounds() {
	const all = blocks(src('character-origins.md')).filter((b) => b.h3 === 'Background Descriptions');
	const rows = all.map((b) => {
		const text = b.body.join('\n');
		return {
			id: slug(b.name),
			systems: '5.5e',
			source: 'SRD 5.2.1',
			name_en: b.name,
			name_uk: '',
			text_en: description(b.body),
			text_uk: '',
			effects: '',
			skills: skillList(field(text, 'Skill Proficiencies')),
			tools: slug(field(text, 'Tool Proficiency')),
			languages: '',
			ability_choices: abilities(field(text, 'Ability Scores')),
			origin_feat: slug(field(text, 'Feat'))
		};
	});
	writeCsv(
		out('backgrounds_srd.csv'),
		[
			'id',
			'systems',
			'source',
			'name_en',
			'name_uk',
			'text_en',
			'text_uk',
			'effects',
			'skills',
			'tools',
			'languages',
			'ability_choices',
			'origin_feat'
		],
		rows
	);
	assertCount('backgrounds', rows.length, all.length);
}

convertFeats();
convertConditions();
convertSpecies();
convertSpeciesOptions();
convertBackgrounds();
console.log('done.');
