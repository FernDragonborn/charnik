/*
 * SRD 5.2.1 (CC-BY-4.0) classes.md → content/srd-2024/classes_srd.csv + class_features_srd.csv
 * All tagged 5.5e. Class-level fields come from each "Core <Class> Traits" table; features
 * are the `#### Level N: Name` blocks BEFORE the subclass section (subclasses are a
 * separate concept, not seeded here). caster type is derived from the spell-slot columns
 * in the class's Features table (9 levels → full, ≤5 → half, Pact Magic → pact, none).
 * Counts are asserted against the source. Run: node tools/srd/convert-classes.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { blocks, description, abilities, slug, writeCsv, assertCount, dedupeIds } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const md = readFileSync(resolve(root, 'tools/srd-src/2024/classes.md'), 'utf8');

// EFX-A7: the martial-weapon subsets a class's proficiency can restrict to ("Martial weapons that
// have the Finesse or Light property" — Rogue; "…the Light property" — Monk). Resolved from the
// ACTUAL converted item set (data-driven, RAW-correct, no hand-authored weapon lists). Reads the
// already-generated items CSV; the item roster is stable, so run order doesn't matter.
function martialSubsets(itemsCsvPath) {
	const raw = readFileSync(itemsCsvPath, 'utf8')
		.replace(/^﻿/, '') // strip the UTF-8 BOM before the #-filter
		.split('\n')
		.filter((l) => !l.startsWith('#'))
		.join('\n');
	const weapons = Papa.parse(raw, { header: true, skipEmptyLines: true }).data.filter(
		(r) => r.category === 'weapon' && /^martial (melee|ranged)$/i.test(r.item_type || '')
	);
	return {
		finesseOrLight: weapons
			.filter((r) => /finesse|light/i.test(r.properties || ''))
			.map((r) => r.id),
		light: weapons.filter((r) => /\blight\b/i.test(r.properties || '')).map((r) => r.id)
	};
}

/** Armor Training cell → normalized categories. "None" → blank (proficient with nothing). */
function parseArmorProfs(cell) {
	const c = (cell || '').toLowerCase();
	if (/\bnone\b/.test(c) || !c) return '';
	const out = [];
	if (/\blight\b/.test(c)) out.push('light');
	if (/\bmedium\b/.test(c)) out.push('medium');
	if (/\bheavy\b/.test(c)) out.push('heavy');
	if (/shield/.test(c)) out.push('shield');
	return out.join(',');
}

/** Weapon Proficiencies cell → categories (simple/martial) + specific ids for the conditional
 *  "Martial weapons that have the Finesse/Light property" grants (Rogue/Monk). */
function parseWeaponProfs(cell, subsets) {
	const c = (cell || '').toLowerCase();
	const out = [];
	if (/\bsimple\b/.test(c)) out.push('simple');
	if (/martial/.test(c)) {
		if (/finesse/.test(c)) out.push(...subsets.finesseOrLight);
		else if (/property/.test(c)) out.push(...subsets.light); // "…that have the Light property"
		else out.push('martial'); // unconditional
	}
	return out.join(',');
}

const subsets = martialSubsets(resolve(root, 'content/srd-2024/items_srd.csv'));

const strip = (s) =>
	s
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&#39;/g, "'")
		.trim();

// split into the 12 `## Class` chunks (top-level ## headers in classes.md are the classes)
const parts = md.split(/^## (?=[A-Z])/m).slice(1);

const classRows = [];
const featureRows = [];
const subclassRows = [];

for (const part of parts) {
	const name = part.slice(0, part.indexOf('\n')).trim();
	const id = slug(name);

	// --- core traits key/value table ---
	const traits = {};
	const table = (/<table[\s\S]*?<\/table>/i.exec(part) || [''])[0];
	for (const tr of table.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
		const td = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => strip(m[1]));
		if (td.length >= 2) traits[td[0]] = td[1];
	}
	const hitDie = (/d(\d+)/i.exec(traits['Hit Point Die'] || '') || [, ''])[1];

	// skills: "Choose 2: Animal Handling, Athletics, … or Survival"
	const skillCell = traits['Skill Proficiencies'] || '';
	const skillsChoose = (/Choose\s+(?:any\s+)?(\d+)/i.exec(skillCell) || [, ''])[1];
	const after = skillCell.includes(':') ? skillCell.slice(skillCell.indexOf(':') + 1) : '';
	const skillsFrom = /any/i.test(skillCell)
		? 'any' // "Choose any N skills" (e.g. Bard, Rogue)
		: after
				.split(/,| or | and /i)
				.map((s) => slug(s))
				.filter((s) => s && s !== 'or' && s !== 'and')
				.join(',');

	// caster type from the Features-table spell-slot columns
	const pact = /#### Level 1: Pact Magic/.test(part);
	const slotHead = (/Spell Slots per Spell Level[\s\S]{0,800}?<\/thead>/i.exec(part) || [''])[0];
	const slotNums = (strip(slotHead).match(/\b[1-9]\b/g) || []).map(Number);
	const maxSlot = slotNums.length ? Math.max(...slotNums) : 0;
	const caster = pact ? 'pact' : maxSlot >= 6 ? 'full' : maxSlot >= 1 ? 'half' : 'none';

	const spellAbil = (/(\w+)\s+is\s+(?:your|the)\s+spellcasting ability/i.exec(part) || [, ''])[1];
	const spell_ability = spellAbil ? abilities(spellAbil) : '';

	const subclassLevel = (/#### Level (\d+):[^\n]*Subclass/.exec(part) || [, ''])[1];

	// ASI/feat-slot levels: the Level-4 ASI block says "…again at <Class> levels 8, 12, and 16"
	// (Fighter adds 6 & 14, Rogue adds 10); every class also gets the Epic Boon feat at 19.
	const asiProse = /Ability Score Improvement[\s\S]*?again at \w+ levels ([\d,\sand]+)/i.exec(part);
	const asiExtra = asiProse ? (asiProse[1].match(/\d+/g) || []).map(Number) : [];
	const asiLevels = [...new Set([4, ...asiExtra, 19])].sort((a, b) => a - b);

	classRows.push({
		id,
		systems: '5.5e',
		source: 'SRD 5.2.1',
		name_en: name,
		name_uk: '',
		text_en: '',
		text_uk: '',
		effects: '',
		hit_die: hitDie ? `d${hitDie}` : '',
		primary_ability: abilities(traits['Primary Ability'] || ''),
		saves: abilities(traits['Saving Throw Proficiencies'] || ''),
		caster,
		spell_ability,
		skills_choose: skillsChoose,
		skills_from: skillsFrom,
		weapon_profs: parseWeaponProfs(traits['Weapon Proficiencies'], subsets),
		armor_profs: parseArmorProfs(traits['Armor Training']),
		subclass_level: subclassLevel,
		asi_levels: asiLevels.join(',')
	});

	const pushFeature = (b, subclass_id) => {
		const m = /^Level (\d+):\s*(.+)$/.exec(b.name);
		if (!m) return;
		const featName = m[2].trim();
		featureRows.push({
			id: `${subclass_id || id}_${slug(featName)}`,
			systems: '5.5e',
			source: 'SRD 5.2.1',
			name_en: featName,
			name_uk: '',
			text_en: description(b.body),
			text_uk: '',
			effects: '',
			class_id: id,
			level: Number(m[1]),
			resource: '',
			subclass_id: subclass_id || ''
		});
	};

	// --- base class features (before the subclass section) ---
	const basePortion = part.split(/^### .+ Subclass:/m)[0];
	for (const b of blocks('## x\n' + basePortion)) pushFeature(b, '');

	// --- the subclass (one per class in SRD 5.2.1) + its features ---
	const subM = /^### .+ Subclass:\s*(.+)$/m.exec(part);
	if (subM) {
		const subName = subM[1].trim();
		const subId = slug(subName);
		const subPortion = part.slice(subM.index);
		subclassRows.push({
			id: subId,
			systems: '5.5e',
			source: 'SRD 5.2.1',
			name_en: subName,
			name_uk: '',
			text_en: '',
			text_uk: '',
			effects: '',
			class_id: id
		});
		for (const b of blocks('## x\n' + subPortion)) pushFeature(b, subId);
	}
}

assertCount('classes', classRows.length, 12);
assertCount('subclasses', subclassRows.length, 12);
assertCount('class features (base + subclass)', featureRows.length, 232); // 174 + 58
dedupeIds(featureRows);
dedupeIds(subclassRows);

writeCsv(
	resolve(root, 'content/srd-2024/classes_srd.csv'),
	[
		'id',
		'systems',
		'source',
		'name_en',
		'name_uk',
		'text_en',
		'text_uk',
		'effects',
		'hit_die',
		'primary_ability',
		'saves',
		'caster',
		'spell_ability',
		'skills_choose',
		'skills_from',
		'weapon_profs',
		'armor_profs',
		'subclass_level',
		'asi_levels'
	],
	classRows
);
writeCsv(
	resolve(root, 'content/srd-2024/class_features_srd.csv'),
	[
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
		'subclass_id'
	],
	featureRows
);
writeCsv(
	resolve(root, 'content/srd-2024/subclasses_srd.csv'),
	['id', 'systems', 'source', 'name_en', 'name_uk', 'text_en', 'text_uk', 'effects', 'class_id'],
	subclassRows
);
console.log(
	'classes:',
	classRows
		.map((c) => `${c.id}(${c.hit_die},${c.caster}${c.spell_ability ? '/' + c.spell_ability : ''})`)
		.join(' ')
);
console.log('subclasses:', subclassRows.map((s) => s.id).join(' '));
