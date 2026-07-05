/*
 * SRD 5.1 (CC-BY-4.0, Tabyltop) → content/srd-2014/*.csv  (tagged 5e, source "SRD 5.1")
 * Prose types are parsed from the semantic HTML (SRD5.1-CCBY4.0License-TT.html): each
 * entry is an <h4 id='…'> with bold name, fields are <p><b>Label:</b>value</p>. Monsters
 * come from the pre-structured Monsters JSON. Counts asserted. Run: node tools/srd/convert-2014.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slug, writeCsv, assertCount, dedupeIds } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const src = (f) => readFileSync(resolve(root, 'tools/srd-src/2014', f), 'utf8');
const out = (f) => resolve(root, 'content/srd-2014', f);
const SRC = 'SRD5.1-CCBY4.0License-TT';

const strip = (s) =>
	s
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&#39;|&rsquo;|’/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

/** Walk the HTML into entries: {level, id, name, paras[]} (paras = raw inner-HTML of <p>). */
function htmlEntries(html) {
	const lines = html.split(/\r?\n/);
	const entries = [];
	let cur = null;
	for (const line of lines) {
		const h = /<h([234])[^>]*?(?:id='([^']*)')?[^>]*>[\s\S]*?<b>([\s\S]*?)<\/b>/i.exec(line);
		if (h) {
			if (cur) entries.push(cur);
			cur = { level: Number(h[1]), id: h[2] || '', name: strip(h[3]), paras: [] };
			continue;
		}
		const p = /<p>([\s\S]*?)<\/p>/i.exec(line);
		if (p && cur) cur.paras.push(p[1]);
	}
	if (cur) entries.push(cur);
	return entries;
}

/** Read a `<b>Label: </b>value` paragraph. */
const bField = (paras, label) => {
	for (const p of paras) {
		const m = new RegExp(`<b>\\s*${label}\\s*:\\s*</b>([\\s\\S]*)`, 'i').exec(p);
		if (m) return strip(m[1]);
	}
	return '';
};

const ABIL = {
	strength: 'str',
	dexterity: 'dex',
	constitution: 'con',
	intelligence: 'int',
	wisdom: 'wis',
	charisma: 'cha'
};

// --- spells ------------------------------------------------------------------
function convertSpells() {
	const entries = htmlEntries(src(`${SRC}.html`));
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
	const rows = [];
	for (const e of entries) {
		const em = e.paras.map((p) => /<em>([\s\S]*?)<\/em>/i.exec(p)).find(Boolean);
		if (!em) continue;
		const meta = strip(em[1]); // "3rd-level Evocation" | "Evocation cantrip"
		let level, school;
		const lv = /^(\d)(?:st|nd|rd|th)-level\s+(\w+)/i.exec(meta);
		const ca = /^(\w+)\s+cantrip/i.exec(meta);
		if (lv) {
			level = Number(lv[1]);
			school = lv[2].toLowerCase();
		} else if (ca) {
			level = 0;
			school = ca[1].toLowerCase();
		} else continue;
		if (!SCHOOLS.includes(school)) continue;

		// Source quirks: some spells use singular "Component:", and a couple have the
		// "Casting Time" label split by PDF extraction into "Casting" + "Time:".
		const compRaw = bField(e.paras, 'Components?');
		const castingTime = bField(e.paras, 'Casting Time') || bField(e.paras, 'Time');
		const durRaw = bField(e.paras, 'Duration');
		// The Duration paragraph often glues the description straight onto the value
		// ("Instantaneous A bright…", "1 minuteA wall…"). Split at the first
		// lowercase→(optional space)→uppercase seam; if none, the value stands alone and
		// the description lives in later plain paragraphs.
		let duration = durRaw,
			gluedDesc = '';
		const seam = /([a-z,)])(\s*)([A-Z])/.exec(durRaw);
		if (seam) {
			const upAt = seam.index + seam[1].length + seam[2].length;
			duration = durRaw.slice(0, upAt).trim();
			gluedDesc = durRaw.slice(upAt).trim();
		}
		// description = the glued tail + any plain (non-<b>, non-<em>) paragraphs after
		// "At Higher Levels" rides in a <p><b><em>…</em></b> para (both tags) → pull it
		// out explicitly, and keep it out of the description.
		const ahlPara = e.paras.find((p) => /At Higher Levels/i.test(p));
		const higher = ahlPara
			? strip(ahlPara)
					.replace(/^.*?At Higher Levels\.?\s*/i, '')
					.trim()
			: '';
		const plain = e.paras
			.filter((p) => !/<b>|<em>/i.test(p))
			.map(strip)
			.filter(Boolean);
		const descAll = [gluedDesc, ...plain].join('\n');
		const description = descAll.replace(/\n?At Higher Levels\.[\s\S]*$/i, '').trim();
		const low = description.toLowerCase();

		let resolution = 'none',
			save = '';
		if (/spell attack/.test(low)) resolution = 'attack';
		else {
			const sm = /(strength|dexterity|constitution|intelligence|wisdom|charisma) saving throw/.exec(
				low
			);
			if (sm) {
				resolution = 'save';
				save = ABIL[sm[1]];
			} else if (/regains? (?:a number of )?hit points|regains hit points/.test(low))
				resolution = 'auto';
		}
		const dm = /(\d+d\d+)\s+([A-Za-z]+)\s+damage/.exec(description);
		const matM = /\(([^)]*)\)/.exec(compRaw);

		rows.push({
			id: slug(e.name),
			systems: '5e',
			source: 'SRD 5.1',
			name_en: e.name,
			name_uk: '',
			text_en: description,
			text_uk: '',
			effects: '',
			level,
			school,
			casting_time: castingTime,
			range: bField(e.paras, 'Range'),
			components: (compRaw.match(/\b[VSM]\b/g) || []).join(','),
			material: matM ? matM[1].trim() : '',
			duration,
			concentration: String(/^concentration/i.test(duration)),
			ritual: String(/ritual/i.test(castingTime)),
			classes: '', // SRD 5.1 lists classes separately, not in the spell block
			resolution,
			save_ability: save,
			damage: dm ? `${dm[1]} ${dm[2].toLowerCase()}` : '',
			higher_level: higher
		});
	}
	rows.sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
	assertCount('spells', rows.length, 319); // canonical SRD 5.1 spell count
	dedupeIds(rows);
	writeCsv(
		out('spells_srd.csv'),
		[
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
		],
		rows
	);
	console.log(
		'spells by level:',
		Object.entries(rows.reduce((a, r) => ((a[r.level] = (a[r.level] || 0) + 1), a), {}))
			.map(([l, n]) => `L${l}:${n}`)
			.join(' ')
	);
	return rows.length;
}

// --- monsters (from the pre-structured Monsters JSON) ------------------------
function convertMonsters() {
	const data = JSON.parse(src('Monsters-SRD5.1-CCBY4.0License-TT.json'));
	const list = data.monsters;
	const rows = list.map((m) => {
		const acM = /(\d+)/.exec(m.armor_class || '');
		const hpM = /(\d+)\s*(?:\(([^)]*)\))?/.exec(m.hit_points || '');
		const st = m.stats || {};
		const score = (v) => (/(\d+)/.exec(v || '') || [, ''])[1]; // some are glued "29(+9)"
		const body = [
			...(m.abilities || []).map((a) => `${a.name} ${a.description}`),
			...((m.actions || []).length
				? ['Actions.', ...m.actions.map((a) => `${a.name} ${a.description}`)]
				: [])
		].join('\n');
		return {
			id: slug(m.name),
			systems: '5e',
			source: 'SRD 5.1',
			name_en: m.name,
			name_uk: '',
			text_en: body,
			text_uk: '',
			effects: '',
			size: (m.size || '').toLowerCase(),
			creature_type: (m.type || '').toLowerCase(),
			alignment: m.alignment || '',
			ac: acM ? acM[1] : '',
			hp: hpM ? hpM[1] : '',
			hp_formula: hpM && hpM[2] ? hpM[2].trim() : '',
			speed: m.speed || '',
			str: score(st.str),
			dex: score(st.dex),
			con: score(st.con),
			int: score(st.int),
			wis: score(st.wis),
			cha: score(st.cha),
			cr: (/^([0-9/]+)/.exec(m.challenge || '') || [, ''])[1],
			senses: m.senses || '',
			languages: '',
			skills: m.skills || ''
		};
	});
	assertCount('monsters', rows.length, 201); // Tabyltop Monsters JSON (SRD 5.1 Monsters chapter)
	dedupeIds(rows);
	writeCsv(
		out('monsters_srd.csv'),
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
			'creature_type',
			'alignment',
			'ac',
			'hp',
			'hp_formula',
			'speed',
			'str',
			'dex',
			'con',
			'int',
			'wis',
			'cha',
			'cr',
			'senses',
			'languages',
			'skills'
		],
		rows
	);
	return rows.length;
}

/** Raw HTML between two heading ids (start inclusive of its <h*>, end exclusive). */
function sliceById(html, startId, endId) {
	const s = html.indexOf(`id='${startId}'`);
	const e = endId ? html.indexOf(`id='${endId}'`) : html.length;
	const s2 = html.lastIndexOf('<h', s);
	return html.slice(s2, endId ? html.lastIndexOf('<h', e) : e);
}

// --- conditions (flat entries under the conditions appendix) -----------------
const CONDITIONS = [
	'Blinded',
	'Charmed',
	'Deafened',
	'Exhaustion',
	'Frightened',
	'Grappled',
	'Incapacitated',
	'Invisible',
	'Paralyzed',
	'Petrified',
	'Poisoned',
	'Prone',
	'Restrained',
	'Stunned',
	'Unconscious'
];
function convertConditions() {
	const entries = htmlEntries(src(`${SRC}.html`));
	const want = new Set(CONDITIONS);
	const rows = entries
		.filter((e) => want.has(e.name))
		.map((e) => ({
			id: slug(e.name),
			systems: '5e',
			source: 'SRD 5.1',
			name_en: e.name,
			name_uk: '',
			text_en: e.paras.map(strip).filter(Boolean).join('\n'),
			text_uk: '',
			effects: '',
			negative: String(e.name !== 'Invisible')
		}));
	assertCount('conditions', rows.length, 15);
	writeCsv(
		out('conditions_srd.csv'),
		['id', 'systems', 'source', 'name_en', 'name_uk', 'text_en', 'text_uk', 'effects', 'negative'],
		rows
	);
	return rows.length;
}

// Racial Ability Score Increase → flat-bonus effect tokens (5e puts the ASI on the species).
// "Your Constitution score increases by 2." → "flat-bonus:con+2"; Human "each increase by 1" →
// all six. Half-Elf's "+1 to two of your choice" is a choice (not a fixed token) — deferred.
const ABIL_ABBR = {
	strength: 'str',
	dexterity: 'dex',
	constitution: 'con',
	intelligence: 'int',
	wisdom: 'wis',
	charisma: 'cha'
};
function raceAsi(text) {
	// only the BASE race trait — the first sentence after "Ability Score Increase." — so the
	// subrace ASI embedded later in the block (Hill Dwarf +1 WIS, High Elf +1 INT…) doesn't bleed
	// into the base race. Subraces become their own species_option rows later.
	const key = 'Ability Score Increase.';
	const at = text.indexOf(key);
	const seg = at >= 0 ? text.slice(at + key.length).split(/\.(?:\s|$)/)[0] : '';
	const out = new Map();
	const re =
		/(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) score increases by (\d+)/gi;
	let m;
	while ((m = re.exec(seg))) out.set(ABIL_ABBR[m[1].toLowerCase()], Number(m[2]));
	if (/ability scores each increase by (\d+)/i.test(seg)) {
		const n = Number(/each increase by (\d+)/i.exec(seg)[1]);
		for (const a of Object.values(ABIL_ABBR)) out.set(a, n);
	}
	return [...out].map(([a, n]) => `flat-bonus:${a}+${n}`).join(';');
}

// A "+N to M ability scores of your choice" ASI (Half-Elf) → "NxM" (e.g. "1x2"). The fixed part
// (Half-Elf's CHA +2) stays in `effects`; this is only the choose-your-own part.
const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
function raceBoostChoice(text) {
	const m =
		/(one|two|three|four|five|six)\s+(?:other\s+|different\s+)?ability scores?(?:\s+of your choice)?\s+(?:each\s+)?increase by (\d+)/i.exec(
			text
		);
	if (!m) return '';
	const count = WORD_NUM[m[1].toLowerCase()] ?? Number(m[1]);
	return `${Number(m[2])}x${count}`;
}

// --- species (9 races; traits are sub-headings → slice whole blocks) ---------
const RACE_IDS = [
	'Dwarf',
	'Elf',
	'Halfling',
	'Human',
	'Dragonborn',
	'Gnome',
	'HalfElf',
	'HalfOrc',
	'Tiefling'
];
function convertSpecies() {
	const html = src(`${SRC}.html`);
	const rows = RACE_IDS.map((rid, i) => {
		const block = sliceById(html, rid, RACE_IDS[i + 1] || 'Barbarian');
		const nameM = /<h2[^>]*>[\s\S]*?<b>([\s\S]*?)<\/b>/i.exec(block);
		const text = strip(block.replace(/<h2[\s\S]*?<\/h2>/i, ''));
		const name = nameM ? strip(nameM[1]) : rid;
		const sizeM = /your size is (\w+)/i.exec(text) || /\bis (Small|Medium)\b/i.exec(text);
		const speedM = /walking speed is (\d+)\s*feet/i.exec(text);
		return {
			id: slug(name),
			systems: '5e',
			source: 'SRD 5.1',
			name_en: name,
			name_uk: '',
			text_en: text,
			text_uk: '',
			effects: raceAsi(text), // 5e racial Ability Score Increase → flat-bonus tokens
			size: (sizeM ? sizeM[1] : 'Medium').toLowerCase(),
			speed: speedM ? Number(speedM[1]) : 30,
			creature_type: 'humanoid',
			boost_choice: raceBoostChoice(text) // Half-Elf "+1 to two of your choice"
		};
	});
	assertCount('species', rows.length, 9);
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
			'creature_type',
			'boost_choice'
		],
		rows
	);
	return rows.length;
}

// --- languages (Standard + Exotic tables in the SRD appendix) ----------------
function convertLanguages() {
	const txt = src(`${SRC}.txt`);
	const parseTable = (heading, category) => {
		// anchor on the heading line immediately followed by the "Language …" column header, so the
		// earlier prose mention ("from the Standard Languages table") isn't matched
		const m = new RegExp(heading.replace(/ /g, '\\s+') + '\\s*\\n\\s*Language\\b').exec(txt);
		if (!m) return [];
		// the block runs from the heading to the next blank line; drop the heading + column header
		const block = txt
			.slice(m.index)
			.split(/\n\s*\n/)[0]
			.split('\n')
			.slice(2);
		return block
			.filter((l) => l.trim())
			.map((l) => {
				const cells = l.trim().split(/\s{2,}/); // fixed-width columns → 2+ spaces separate
				const name = cells[0].trim();
				const speakers = (cells.slice(1, -1).join(' ') || '').replace(/\s+/g, ' ').trim();
				const script = (cells[cells.length - 1] || '').trim();
				return {
					id: slug(name),
					systems: '5e',
					source: 'SRD 5.1',
					name_en: name,
					name_uk: '',
					text_en: `Typical speakers: ${speakers || '—'}. Script: ${script === '-' ? 'none' : script || '—'}.`,
					text_uk: '',
					effects: '',
					category,
					speakers,
					script: script === '-' ? '' : script
				};
			});
	};
	const rows = [
		...parseTable('Standard Languages', 'standard'),
		...parseTable('Exotic Languages', 'exotic')
	];
	assertCount('languages', rows.length, 16);
	writeCsv(
		out('languages_srd.csv'),
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
			'speakers',
			'script'
		],
		rows
	);
	return rows.length;
}

// --- species options (2014 subraces) — one per race in SRD 5.1 ---------------
// SRD 5.1 ships exactly one subrace per subrace-having race (Hill Dwarf / High Elf / Lightfoot /
// Rock Gnome). Each is an <h4> block after its parent race's base traits; its first "Ability Score
// Increase." is the SUBRACE's ASI → flat-bonus tokens. `end` = the next race heading id.
const SUBRACES = [
	{ id: 'HillDwarf', end: 'Elf', species: 'Dwarf' },
	{ id: 'HighElf', end: 'Halfling', species: 'Elf' },
	{ id: 'Lightfoot', end: 'Human', species: 'Halfling' },
	{ id: 'RockGnome', end: 'HalfElf', species: 'Gnome' }
];
const SPECIES_OPTION_COLS = [
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
];
function convertSpeciesOptions() {
	const html = src(`${SRC}.html`);
	const rows = SUBRACES.map((sr) => {
		const block = sliceById(html, sr.id, sr.end);
		const nameM = /<b>([\s\S]*?)<\/b>/i.exec(block);
		const name = nameM ? strip(nameM[1]) : sr.id;
		const text = strip(block.replace(/<h[1-6][\s\S]*?<\/h[1-6]>/i, ''));
		return {
			id: slug(name),
			systems: '5e',
			source: 'SRD 5.1',
			name_en: name,
			name_uk: '',
			text_en: text,
			text_uk: '',
			effects: raceAsi(text), // the subrace's own Ability Score Increase
			species_id: slug(sr.species),
			kind: 'subrace',
			option_label: 'Subrace'
		};
	});
	assertCount('species_options', rows.length, 4);
	writeCsv(out('species_options_srd.csv'), SPECIES_OPTION_COLS, rows);
	return rows.length;
}

// --- backgrounds (SRD 5.1 has only Acolyte) + feats (only Grappler) ----------
function convertBackgrounds() {
	const html = src(`${SRC}.html`);
	const block =
		sliceById(html, 'Acolyte', 'PersonalityTrait') ||
		sliceById(html, 'Acolyte', null).slice(0, 4000);
	const text = strip(block.replace(/<h[23][\s\S]*?<\/h[23]>/i, ''));
	const skills = (/Skill Proficiencies?:\s*([^.]+?)(?:\.|Languages|Tool)/i.exec(text) || [, ''])[1];
	const langsM = /Languages:\s*([^.]+)/i.exec(text);
	const rows = [
		{
			id: 'acolyte',
			systems: '5e',
			source: 'SRD 5.1',
			name_en: 'Acolyte',
			name_uk: '',
			text_en: text.slice(0, 1500),
			text_uk: '',
			effects: '',
			skills: skills
				.split(/,|and/)
				.map((s) => slug(s))
				.filter(Boolean)
				.join(','),
			tools: '',
			languages: langsM ? '2' : '',
			ability_choices: '',
			origin_feat: ''
		}
	];
	assertCount('backgrounds', rows.length, 1);
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
	return rows.length;
}
function convertFeats() {
	const entries = htmlEntries(src(`${SRC}.html`)).filter((e) => e.name === 'Grappler');
	const rows = entries.map((e) => {
		const text = e.paras.map(strip).filter(Boolean).join('\n');
		const pm = /Prerequisite:\s*([^\n]+?)(?:\s{2,}|You)/i.exec(text);
		return {
			id: 'grappler',
			systems: '5e',
			source: 'SRD 5.1',
			name_en: 'Grappler',
			name_uk: '',
			text_en: text,
			text_uk: '',
			effects: '',
			category: 'general-2014',
			prereq: pm ? pm[1].trim() : '',
			repeatable: 'false'
		};
	});
	assertCount('feats', rows.length, 1);
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
	return rows.length;
}

// --- classes + class features ------------------------------------------------
const CLASS_IDS = [
	'Barbarian',
	'Bard',
	'Cleric',
	'Druid',
	'Fighter',
	'Monk',
	'Paladin',
	'Ranger',
	'Rogue',
	'Sorcerer',
	'Warlock',
	'Wizard'
];
// caster type + spellcasting ability are fixed mechanical classifications of the 12 SRD
// classes, identical across editions — not prose. Use the known values (matches the
// values derived from the 5.2.1 source) rather than re-parsing fragile 2014 slot tables.
const CASTER = {
	barbarian: 'none',
	bard: 'full',
	cleric: 'full',
	druid: 'full',
	fighter: 'none',
	monk: 'none',
	paladin: 'half',
	ranger: 'half',
	rogue: 'none',
	sorcerer: 'full',
	warlock: 'pact',
	wizard: 'full'
};
const SPELL_ABIL = {
	bard: 'cha',
	cleric: 'wis',
	druid: 'wis',
	paladin: 'cha',
	ranger: 'wis',
	sorcerer: 'cha',
	warlock: 'cha',
	wizard: 'int'
};
// SRD 5.1 subclass-choice level (differs from 2024; a known mechanical fact per class).
const SUBCLASS_LEVEL_2014 = {
	barbarian: 3,
	bard: 3,
	cleric: 1,
	druid: 2,
	fighter: 3,
	monk: 3,
	paladin: 3,
	ranger: 3,
	rogue: 3,
	sorcerer: 1,
	warlock: 1,
	wizard: 2
};
const HIT_DIE = /Hit Dice:\s*1(d\d+)/i;
const norm = (s) =>
	s
		.toLowerCase()
		.replace(/\([^)]*\)/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
function convertClasses() {
	const html = src(`${SRC}.html`);
	const classRows = [],
		featureRows = [];
	// slice each class by DOCUMENT position (array order ≠ doc order), end at next class
	const pos = CLASS_IDS.map((id) => ({ id, at: html.indexOf(`id='${id}'`) })).sort(
		(a, b) => a.at - b.at
	);
	const endOf = new Map();
	pos.forEach((p, k) => endOf.set(p.id, pos[k + 1] ? pos[k + 1].id : 'Backgrounds'));

	for (const cid of CLASS_IDS) {
		const block = sliceById(html, cid, endOf.get(cid));
		const text = strip(block);
		const id = slug(cid);

		// progression table rows: level + full row text (the Features column index varies
		// per class — rogue has a Sneak Attack column first — so match heading names against
		// the whole row rather than a fixed cell).
		const table = (/<table[\s\S]*?<\/table>/i.exec(block) || [''])[0];
		const trs = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];
		const tableRows = [];
		for (const tr of trs) {
			const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => strip(m[1]));
			const lm = /^(\d+)(?:st|nd|rd|th)$/.exec(cells[0] || '');
			if (lm) tableRows.push({ lvl: Number(lm[1]), text: ' ' + norm(cells.join(' ')) + ' ' });
		}
		const headings = htmlEntries(block).filter((e) => e.level === 3 || e.level === 4);
		const levelOf = new Map();
		for (const h of headings) {
			const nn = norm(h.name);
			if (!nn) continue;
			const hit = tableRows.find(
				(r) => r.text.includes(` ${nn} `) || r.text.includes(`${nn},`) || r.text.includes(`${nn} `)
			);
			if (hit && !levelOf.has(nn)) levelOf.set(nn, hit.lvl);
		}

		const savesM = /Saving Throws:\s*([A-Za-z, ]+?)(?:Skills|Tools|Armor|$)/i.exec(text);
		const saves = savesM
			? (
					savesM[1]
						.toLowerCase()
						.match(/strength|dexterity|constitution|intelligence|wisdom|charisma/g) || []
				).map(
					(a) =>
						({
							strength: 'str',
							dexterity: 'dex',
							constitution: 'con',
							intelligence: 'int',
							wisdom: 'wis',
							charisma: 'cha'
						})[a]
				)
			: [];
		const skM = /Skills:\s*Choose (any )?(\w+)(?:\s+skills?)?(?:\s+from\s+([^.]+))?/i.exec(text);
		const num = { two: 2, three: 3, four: 4, one: 1 };
		const splitSkills = (s) =>
			s
				.split(/,|\bor\b|\band\b/i)
				.map((x) => slug(x))
				.filter((x) => x && x !== 'or' && x !== 'and');
		// ASI/feat-slot levels = progression-table rows whose Features cell names an ASI (Fighter
		// also 6 & 14, Rogue also 10, all classes 19) — read from the source table, not hardcoded.
		// match "ability score" (not "…improvement") — the source table truncates some cells
		// (e.g. Rogue L10 reads just "Ability Score"); no other Feature cell starts that way.
		const asiLevels = tableRows
			.filter((r) => r.text.includes('ability score'))
			.map((r) => r.lvl)
			.sort((a, b) => a - b);

		const caster = CASTER[id];
		const subKw =
			/\b(\d+)(?:st|nd|rd|th)[^|]*?(Primal Path|Divine Domain|Bard College|Druid Circle|Martial Archetype|Monastic Tradition|Sacred Oath|Ranger [A-Za-z]*|Roguish Archetype|Sorcerous Origin|Otherworldly Patron|Arcane Tradition)/i.exec(
				text
			);

		classRows.push({
			id,
			systems: '5e',
			source: 'SRD 5.1',
			name_en: cid.replace(/([a-z])([A-Z])/g, '$1 $2'),
			name_uk: '',
			text_en: '',
			text_uk: '',
			effects: '',
			hit_die: (HIT_DIE.exec(text) || [, ''])[1],
			primary_ability: '',
			saves: saves.join(','),
			caster,
			spell_ability: SPELL_ABIL[id] || '',
			skills_choose: skM ? String(num[skM[2].toLowerCase()] || skM[2]) : '',
			skills_from: skM ? (skM[1] ? 'any' : skM[3] ? splitSkills(skM[3]).join(',') : '') : '',
			subclass_level: String(SUBCLASS_LEVEL_2014[id]),
			asi_levels: asiLevels.join(',')
		});

		// feature descriptions = h3/h4 headings with a level found in the progression table
		for (const e of headings) {
			const lvl = levelOf.get(norm(e.name));
			if (!lvl) continue; // archetype/uncharted headings without a base-table level
			featureRows.push({
				id: `${id}-${slug(e.name)}`,
				systems: '5e',
				source: 'SRD 5.1',
				name_en: e.name,
				name_uk: '',
				text_en: e.paras.map(strip).filter(Boolean).join('\n'),
				text_uk: '',
				effects: '',
				class_id: id,
				level: lvl,
				resource: '',
				subclass_id: ''
			});
		}
	}
	// --- subclasses (one per class in SRD 5.1) + their features ---
	const SUBCLASSES = {
		PathoftheBerserker: 'barbarian',
		CollegeofLore: 'bard',
		LifeDomain: 'cleric',
		CircleoftheLand: 'druid',
		Champion: 'fighter',
		WayoftheOpenHand: 'monk',
		OathofDevotion: 'paladin',
		Hunter: 'ranger',
		Thief: 'rogue',
		DraconicBloodline: 'sorcerer',
		TheFiend: 'warlock',
		SchoolofEvocation: 'wizard'
	};
	const subclassRows = [];
	for (const [sid, classId] of Object.entries(SUBCLASSES)) {
		const start = html.indexOf(`id='${sid}'`);
		const rest = html.slice(start);
		const end = rest.indexOf('<h2', 10);
		const block = end > 0 ? rest.slice(0, end) : rest;
		const nameM = /<h3[^>]*>[\s\S]*?<b>([\s\S]*?)<\/b>/i.exec(block);
		const name = nameM ? strip(nameM[1]) : sid;
		const subId = slug(name);
		subclassRows.push({
			id: subId,
			systems: '5e',
			source: 'SRD 5.1',
			name_en: name,
			name_uk: '',
			text_en: '',
			text_uk: '',
			effects: '',
			class_id: classId
		});
		for (const e of htmlEntries(block).filter((e) => e.level === 4)) {
			const ftext = e.paras.map(strip).filter(Boolean).join('\n');
			const lm = /(\d+)(?:st|nd|rd|th) level/i.exec(ftext);
			featureRows.push({
				id: `${subId}-${slug(e.name)}`,
				systems: '5e',
				source: 'SRD 5.1',
				name_en: e.name,
				name_uk: '',
				text_en: ftext,
				text_uk: '',
				effects: '',
				class_id: classId,
				level: lm ? Number(lm[1]) : SUBCLASS_LEVEL_2014[classId],
				resource: '',
				subclass_id: subId
			});
		}
	}
	assertCount('classes', classRows.length, 12);
	assertCount('subclasses', subclassRows.length, 12);
	dedupeIds(featureRows);
	dedupeIds(subclassRows);
	writeCsv(
		out('classes_srd.csv'),
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
			'subclass_level',
			'asi_levels'
		],
		classRows
	);
	writeCsv(
		out('class_features_srd.csv'),
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
		out('subclasses_srd.csv'),
		['id', 'systems', 'source', 'name_en', 'name_uk', 'text_en', 'text_uk', 'effects', 'class_id'],
		subclassRows
	);
	console.log('classes:', classRows.map((c) => `${c.id}(${c.hit_die},${c.caster})`).join(' '));
	return featureRows.length;
}

// --- items (weapons + armor) -------------------------------------------------
// SRD 5.1 HTML splits each table into many tiny <table>s (≈ one per row), so collect ALL
// <td>/<th> cells in the section (heading → next <h2>) and walk them in fixed-size chunks,
// resetting the group/category whenever a known group-label cell appears.
function sectionCells(html, headingId) {
	const start = html.indexOf(`id='${headingId}'`);
	const rest = html.slice(start);
	const nextH2 = rest.indexOf('<h2', 10);
	const region = nextH2 > 0 ? rest.slice(0, nextH2) : rest;
	return [...region.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
		.map((m) => strip(m[1]))
		.filter((c) => c !== '');
}
const ITEM_COLS = [
	'id',
	'systems',
	'source',
	'name_en',
	'name_uk',
	'text_en',
	'text_uk',
	'effects',
	'category',
	'item_type',
	'cost',
	'weight_lb',
	'properties',
	'damage',
	'damage_type',
	'range',
	'ac',
	'armor_dex_cap',
	'str_min',
	'stealth_disadvantage',
	'attunement',
	'rarity'
];
const irow = (o) => ({
	systems: '5e',
	source: 'SRD 5.1',
	name_uk: '',
	text_en: '',
	text_uk: '',
	effects: '',
	cost: '',
	weight_lb: '',
	properties: '',
	damage: '',
	damage_type: '',
	range: '',
	ac: '',
	armor_dex_cap: '',
	str_min: '',
	stealth_disadvantage: 'false',
	attunement: 'false',
	rarity: '',
	...o
});
const wlb = (s) => {
	const m = /([\d.]+)/.exec(s);
	return m ? Number(m[1]) : '';
};

function convertItems() {
	const html = src(`${SRC}.html`);
	const rows = [];
	// weapons: header = 5 cells, then group-label cells + 5-cell rows
	const WG = {
		'Simple Melee Weapons': 'simple melee',
		'Simple Ranged Weapons': 'simple ranged',
		'Martial Melee Weapons': 'martial melee',
		'Martial Ranged Weapons': 'martial ranged'
	};
	let wc = sectionCells(html, 'Weapons'),
		wtype = '',
		nW = 0;
	while (wc.length && !WG[wc[0]]) wc.shift(); // skip header/intro cells
	for (let i = 0; i < wc.length;) {
		if (WG[wc[i]]) {
			wtype = WG[wc[i]];
			i++;
			continue;
		}
		const [name, cost, dmg, weight, props] = wc.slice(i, i + 5);
		i += 5;
		if (!name) continue;
		const dm = /(\d+d\d+|\d+)\s+(\w+)/.exec(dmg || '');
		const p = (props || '')
			.replace(/\s*--\s*/g, '-')
			.replace(/\s+/g, ' ')
			.trim();
		rows.push(
			irow({
				id: slug(name),
				name_en: name,
				category: 'weapon',
				item_type: wtype,
				cost,
				weight_lb: wlb(weight),
				properties: p === '-' ? '' : p,
				damage: dm ? dm[1] : '',
				damage_type: dm ? dm[2].toLowerCase() : '',
				range: (/range\s+(\d+\/\d+)/i.exec(props || '') || [, ''])[1]
			})
		);
		nW++;
	}
	assertCount('weapons', nW, 37);
	// armor: header = 6 cells, group cells + 6-cell rows
	const AG = {
		'Light Armor': 'light',
		'Medium Armor': 'medium',
		'Heavy Armor': 'heavy',
		Shield: 'shield'
	};
	let ac = sectionCells(html, 'Armor'),
		acat = '',
		nA = 0,
		justGrouped = false;
	while (ac.length && AG[ac[0]] === undefined) ac.shift(); // skip header/intro cells
	for (let i = 0; i < ac.length;) {
		// "Shield" is both a group label and the item name → the cell right after a group
		// label is always a data row, never another group.
		if (!justGrouped && AG[ac[i]] !== undefined) {
			acat = AG[ac[i]];
			i++;
			justGrouped = true;
			continue;
		}
		justGrouped = false;
		const [name, cost, acv, str, stealth, weight] = ac.slice(i, i + 6);
		i += 6;
		if (!name) continue;
		if (!/\d\s*(gp|sp|cp)/i.test(cost)) break; // left the armor table (e.g. don/doff times)
		const isShield = acat === 'shield';
		rows.push(
			irow({
				id: slug(name),
				name_en: name,
				category: isShield ? 'shield' : 'armor',
				item_type: isShield ? 'shield' : `${acat} armor`,
				cost,
				weight_lb: wlb(weight),
				ac: (/(\d+)/.exec(acv || '') || [, ''])[1],
				armor_dex_cap: isShield ? '' : acat === 'light' ? '' : acat === 'medium' ? '2' : '0',
				str_min: (/(\d+)/.exec(str || '') || [, ''])[1],
				stealth_disadvantage: String(/disadvantage/i.test(stealth || ''))
			})
		);
		nA++;
	}
	assertCount('armor+shields', nA, 13);

	// adventuring gear: a real <tr>/<td> table (Item, Cost, Weight); <em> rows are
	// category sub-labels (Ammunition, Arcane focus…) and are skipped.
	let nG = 0;
	const gStart = html.indexOf("id='AdventuringGear'");
	const gTable = (/<table[\s\S]*?<\/table>/i.exec(html.slice(gStart)) || [''])[0];
	for (const tr of gTable.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
		const td = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
		if (td.length < 3 || /<em>/i.test(td[0])) continue;
		const name = strip(td[0]);
		if (!name) continue;
		rows.push(
			irow({
				id: slug(name),
				name_en: name,
				category: 'gear',
				item_type: 'adventuring gear',
				cost: strip(td[1]),
				weight_lb: wlb(strip(td[2]))
			})
		);
		nG++;
	}

	// magic items: h4 entries with an <em>Type, rarity (requires attunement)</em> meta.
	let nM = 0;
	const RAR = ['very rare', 'uncommon', 'common', 'rare', 'legendary', 'artifact'];
	const magSlice = html.slice(html.indexOf("id='MagicItemsAZ'"));
	for (const e of htmlEntries(magSlice).filter((x) => x.level === 4)) {
		const metaP = e.paras.find((p) => /<em>/i.test(p)) || '';
		const inner = strip((/<em>([\s\S]*?)<\/em>/i.exec(metaP) || [, ''])[1]).toLowerCase();
		const rar = RAR.find((r) => inner.includes(r));
		if (!rar) continue; // section text, not a magic item
		const type = inner.split(',')[0].trim();
		const category = type.startsWith('armor')
			? 'armor'
			: type.startsWith('weapon')
				? 'weapon'
				: type.startsWith('ammunition')
					? 'ammunition'
					: 'gear';
		rows.push(
			irow({
				id: slug(e.name),
				name_en: e.name,
				text_en: e.paras
					.filter((p) => !/<em>/i.test(p))
					.map(strip)
					.filter(Boolean)
					.join('\n'),
				category,
				item_type: type,
				attunement: String(/requires attunement/.test(inner)),
				rarity: slug(rar)
			})
		);
		nM++;
	}
	console.log(`  gear ${nG}, magic ${nM}`);

	dedupeIds(rows);
	writeCsv(out('items_srd.csv'), ITEM_COLS, rows);
	return rows.length;
}

const nSpells = convertSpells();
const nMonsters = convertMonsters();
const nCond = convertConditions();
const nSpec = convertSpecies();
const nSpecOpt = convertSpeciesOptions();
const nLang = convertLanguages();
const nBg = convertBackgrounds();
const nFeat = convertFeats();
const nFeatures = convertClasses();
const nItems = convertItems();
console.log(
	`SRD 5.1: ${nSpells} spells, ${nMonsters} monsters, ${nCond} conditions, ${nSpec} species, ${nSpecOpt} subraces, ${nLang} languages, ${nBg} backgrounds, ${nFeat} feats, 12 classes, ${nFeatures} class features, ${nItems} items`
);
