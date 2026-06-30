/*
 * SRD 5.2.1 (CC-BY-4.0) classes.md → content/srd/classes_srd.csv + class_features_srd.csv
 * All tagged 5.5e. Class-level fields come from each "Core <Class> Traits" table; features
 * are the `#### Level N: Name` blocks BEFORE the subclass section (subclasses are a
 * separate concept, not seeded here). caster type is derived from the spell-slot columns
 * in the class's Features table (9 levels → full, ≤5 → half, Pact Magic → pact, none).
 * Counts are asserted against the source. Run: node tools/srd/convert-classes.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blocks, description, abilities, slug, writeCsv, assertCount, dedupeIds } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const md = readFileSync(resolve(root, 'tools/srd-src/2024/classes.md'), 'utf8');

const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();

// split into the 12 `## Class` chunks (top-level ## headers in classes.md are the classes)
const parts = md.split(/^## (?=[A-Z])/m).slice(1);

const classRows = [];
const featureRows = [];

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

	classRows.push({
		id, systems: '5.5e', source: 'SRD', name_en: name, name_uk: '', text_en: '', text_uk: '', effects: '',
		hit_die: hitDie ? `d${hitDie}` : '',
		primary_ability: abilities(traits['Primary Ability'] || ''),
		saves: abilities(traits['Saving Throw Proficiencies'] || ''),
		caster,
		spell_ability,
		skills_choose: skillsChoose,
		skills_from: skillsFrom,
		subclass_level: subclassLevel
	});

	// --- base class features (before the subclass section) ---
	const basePortion = part.split(/^### .+ Subclass:/m)[0];
	for (const b of blocks('## x\n' + basePortion)) {
		const m = /^Level (\d+):\s*(.+)$/.exec(b.name);
		if (!m) continue;
		const level = Number(m[1]);
		const featName = m[2].trim();
		featureRows.push({
			id: `${id}-${slug(featName)}`,
			systems: '5.5e', source: 'SRD', name_en: featName, name_uk: '',
			text_en: description(b.body), text_uk: '', effects: '',
			class_id: id, level, resource: ''
		});
	}
}

assertCount('classes', classRows.length, 12);
assertCount('class features', featureRows.length, 174);
dedupeIds(featureRows);

writeCsv(
	resolve(root, 'content/srd/classes_srd.csv'),
	['id', 'systems', 'source', 'name_en', 'name_uk', 'text_en', 'text_uk', 'effects', 'hit_die', 'primary_ability', 'saves', 'caster', 'spell_ability', 'skills_choose', 'skills_from', 'subclass_level'],
	classRows
);
writeCsv(
	resolve(root, 'content/srd/class_features_srd.csv'),
	['id', 'systems', 'source', 'name_en', 'name_uk', 'text_en', 'text_uk', 'effects', 'class_id', 'level', 'resource'],
	featureRows
);
console.log('classes:', classRows.map((c) => `${c.id}(${c.hit_die},${c.caster}${c.spell_ability ? '/' + c.spell_ability : ''})`).join(' '));
