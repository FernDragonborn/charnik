/*
 * SRD 5.2.1 spells → content/srd/spells_srd.csv
 *
 * Reads the CC-BY-4.0 SRD 5.2.1 markdown (tools/srd-src/2024/spells.md, from
 * github.com/downfallx/dnd-5e-srd-markdown) and emits rows matching the spell schema.
 * Source is 2024 SRD → every row is tagged `5.5e` (do NOT claim 5e; 2024 diverges).
 *
 * Structured columns (level/school/components/resolution/damage…) are PARSED from the
 * source text, never invented. Where the text is ambiguous a column is left blank rather
 * than guessed. The canonical description stays verbatim in text_en.
 *
 * Run: node tools/srd/convert-spells.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const SRC = resolve(root, 'tools/srd-src/2024/spells.md');
const OUT = resolve(root, 'content/srd-2024/spells_srd.csv');

const SCHOOLS = [
	'abjuration',
	'conjuration',
	'divination',
	'enchantment',
	'evocation',
	'illusion',
	'necromancy',
	'transmutation'
];
const ABIL = {
	strength: 'str',
	dexterity: 'dex',
	constitution: 'con',
	intelligence: 'int',
	wisdom: 'wis',
	charisma: 'cha'
};

const slug = (s) =>
	s
		.toLowerCase()
		.replace(/['’]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

/** Split the file into `#### Name` blocks. */
function blocks(md) {
	const lines = md.split(/\r?\n/);
	const out = [];
	let cur = null;
	for (const line of lines) {
		const m = /^####\s+(.+?)\s*$/.exec(line);
		if (m) {
			if (cur) out.push(cur);
			cur = { name: m[1], body: [] };
		} else if (cur) {
			cur.body.push(line);
		}
	}
	if (cur) out.push(cur);
	return out;
}

function parseSpell(name, body) {
	// meta line: _Level N School (classes)_  OR  _School Cantrip (classes)_
	const text = body.join('\n');
	const meta =
		/^_\s*Level\s+(\d)\s+([A-Za-z]+)\s*\(([^)]*)\)_/m.exec(text) ||
		/^_\s*([A-Za-z]+)\s+Cantrip\s*\(([^)]*)\)_/m.exec(text);
	if (!meta) return null; // not a spell block

	let level, schoolRaw, classesRaw;
	if (meta[0].toLowerCase().includes('cantrip')) {
		level = 0;
		schoolRaw = meta[1];
		classesRaw = meta[2];
	} else {
		level = Number(meta[1]);
		schoolRaw = meta[2];
		classesRaw = meta[3];
	}
	const school = schoolRaw.toLowerCase();
	if (!SCHOOLS.includes(school)) return null;

	const field = (label) => {
		const m = new RegExp(`^\\*\\*${label}:\\*\\*\\s*(.+?)\\s*$`, 'm').exec(text);
		return m ? m[1].trim() : '';
	};
	const castingRaw = field('Casting Time');
	const ritual = /ritual/i.test(castingRaw);
	const casting_time = castingRaw.replace(/\s*or\s*ritual/i, '').trim();
	const range = field('Range');
	const durationRaw = field('Duration');
	const concentration = /^concentration/i.test(durationRaw);

	// components: letters before any "(", material = parenthetical.
	// Source is inconsistent: "**Components:**" (plural) vs "**Component:**" (singular).
	const compRaw = field('Components?');
	const compLetters = (compRaw.match(/\b[VSM]\b/g) || []).join(',');
	const matM = /\(([^)]*)\)/.exec(compRaw);
	const material = matM ? matM[1].trim() : '';

	// description = paragraphs after Duration, excluding the meta/field lines and the
	// higher-level rider; keep verbatim.
	const lines = text.split('\n');
	const descLines = [];
	let higher = '';
	for (const ln of lines) {
		if (/^_/.test(ln) && /(Using a Higher-Level Spell Slot|Cantrip Upgrade)\._/i.test(ln)) {
			higher = ln.replace(/^_.*?\._\s*/, '').trim();
			continue;
		}
		if (/^\*\*\w/.test(ln)) continue; // **Casting Time:** etc.
		if (/^_\s*(Level|[A-Za-z]+\s+Cantrip)/.test(ln)) continue; // meta line
		if (ln.trim() === '') continue;
		descLines.push(ln.trim());
	}
	const description = descLines.join('\n');
	const low = description.toLowerCase();

	// resolution + save_ability, derived from the real text
	let resolution = 'none';
	let save_ability = '';
	if (/spell attack/.test(low)) {
		resolution = 'attack';
	} else {
		const sm = /(strength|dexterity|constitution|intelligence|wisdom|charisma) saving throw/.exec(
			low
		);
		if (sm) {
			resolution = 'save';
			save_ability = ABIL[sm[1]];
		} else if (/regains?\s+(?:a number of\s+)?hit points|regains hit points/.test(low)) {
			resolution = 'auto';
		}
	}

	// damage: first "NdN [<type>] damage" — the type is optional (e.g. Sorcerous Burst deals
	// "1d8 damage of a type you choose", so it has dice but no fixed type)
	const dm = /(\d+d\d+)\s+(?:([A-Za-z]+)\s+)?damage/.exec(description);
	const damage = dm ? (dm[2] ? `${dm[1]} ${dm[2].toLowerCase()}` : dm[1]) : '';

	const classes = classesRaw
		.split(',')
		.map((c) => slug(c.trim()))
		.filter(Boolean)
		.join(',');

	return {
		id: slug(name),
		systems: '5.5e',
		source: 'SRD 5.2.1',
		name_en: name,
		name_uk: '',
		text_en: description,
		text_uk: '',
		effects: '',
		level,
		school,
		casting_time,
		range,
		components: compLetters,
		material,
		duration: durationRaw,
		concentration: String(concentration),
		ritual: String(ritual),
		classes,
		resolution,
		save_ability,
		damage,
		higher_level: higher
	};
}

const md = readFileSync(SRC, 'utf8');
const rows = [];
for (const b of blocks(md)) {
	const r = parseSpell(b.name, b.body);
	if (r) rows.push(r);
}
rows.sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));

const columns = [
	'id',
	'systems',
	'source',
	'name_en',
	'name_uk',
	'text_en',
	'text_uk',
	'effects',
	'level',
	'school',
	'casting_time',
	'range',
	'components',
	'material',
	'duration',
	'concentration',
	'ritual',
	'classes',
	'resolution',
	'save_ability',
	'damage',
	'higher_level'
];
const csv = Papa.unparse({ fields: columns, data: rows }, { newline: '\n' });
writeFileSync(OUT, csv + '\n', 'utf8');
console.log(`wrote ${rows.length} spells → ${OUT}`);
console.log(
	'by level:',
	Object.entries(rows.reduce((a, r) => ((a[r.level] = (a[r.level] || 0) + 1), a), {}))
		.map(([l, n]) => `L${l}:${n}`)
		.join(' ')
);
