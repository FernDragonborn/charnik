/*
 * SRD 5.2.1 (CC-BY-4.0) markdown → srd/*.csv  —  ALL types except spells
 * (spells have their own script). Source: tools/srd-src/2024/ (downfallx mirror).
 *
 * Every row is GENERATED from the official document, tagged `5.5e`. Structured columns
 * are parsed from the source; ambiguous ones are left blank, never guessed. Each type
 * asserts its emitted row count against what the source contains, so a parser that drops
 * an entry fails loudly. Run: node tools/srd/convert.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import {
	blocks,
	field,
	description,
	abilities,
	skillList,
	slug,
	writeCsv,
	assertCount,
} from './lib.mjs';
import { packDir } from '../content-repo.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const src = (f) => readFileSync(resolve(root, 'tools/srd-src/2024', f), 'utf8');
const out = (f) => resolve(packDir('srd-2024'), f);

// Preserve `effects` authored AFTER conversion (condition tokens are curated from SRD rules into the
// bounded vocab — CONDITIONS-1 — not present in the HTML source). A raw re-run must not wipe them.
function existingEffectsById(csvFile) {
	const path = out(csvFile);
	if (!existsSync(path)) return new Map();
	const raw = readFileSync(path, 'utf8')
		.replace(/^﻿/, '') // strip the UTF-8 BOM before the #-filter
		.split('\n')
		.filter((l) => !l.startsWith('#'))
		.join('\n');
	const map = new Map();
	for (const r of Papa.parse(raw, { header: true, skipEmptyLines: true }).data)
		if (r.id && r.effects) map.set(r.id, r.effects);
	return map;
}

// --- feats -------------------------------------------------------------------
const FEAT_SECTIONS = {
	'Origin Feats': 'origin',
	'General Feats': 'general',
	'Fighting Style Feats': 'fighting_style',
	'Epic Boon Feats': 'epic_boon',
};
// Feat `effects` (mechanical tokens) and `ability_choice` (half-feat +1 targets) are authored AFTER
// conversion — curated from the SRD text, NOT present as such in the prose. Preserve them by id, or a
// raw re-run silently wipes the authoring (same pattern as class_features).
function existingFeatCol(col) {
	const path = out('feats_srd.csv');
	if (!existsSync(path)) return new Map();
	const raw = readFileSync(path, 'utf8')
		.replace(/^﻿/, '')
		.split('\n')
		.filter((l) => !l.startsWith('#'))
		.join('\n');
	const map = new Map();
	for (const r of Papa.parse(raw, { header: true, skipEmptyLines: true }).data)
		if (r.id && r[col]) map.set(r.id, r[col]);
	return map;
}

function convertFeats() {
	const authored = existingFeatCol('effects');
	const authoredAbility = existingFeatCol('ability_choice');
	const authoredSkill = existingFeatCol('skill_choice');
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
			effects: authored.get(slug(b.name)) ?? '', // preserve tokens authored post-conversion
			category: FEAT_SECTIONS[b.h3],
			prereq: prereqM ? prereqM[1].trim() : '',
			repeatable: String(/_Repeatable\._/.test(text)),
			ability_choice: authoredAbility.get(slug(b.name)) ?? '', // half-feat +1 targets, preserved
			skill_choice: authoredSkill.get(slug(b.name)) ?? '', // §C skill choice-grant count, preserved
		};
	});
	writeCsv(
		out('feats_srd.csv'),
		[
			'id',
			'systems',
			'source',
			'category',
			'prereq',
			'repeatable',
			'ability_choice',
			'skill_choice',
			'effects',
			'name_en',
			'name_uk',
			'text_en',
			'text_uk',
		],
		rows,
	);
	assertCount('feats', rows.length, all.length);
}

// --- conditions (glossary entries tagged "[Condition]") ----------------------
const POSITIVE_CONDITIONS = new Set(['invisible']); // the only beneficial one in SRD
function convertConditions() {
	const all = blocks(src('rules-glossary.md')).filter((b) => /\[Condition\]\s*$/.test(b.name));
	const authored = existingEffectsById('conditions_srd.csv'); // CONDITIONS-1 tokens, not in the source
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
			effects: authored.get(id) ?? '',
			negative: String(!POSITIVE_CONDITIONS.has(id)),
		};
	});
	writeCsv(
		out('conditions_srd.csv'),
		['id', 'systems', 'source', 'negative', 'effects', 'name_en', 'name_uk', 'text_en', 'text_uk'],
		rows,
	);
	assertCount('conditions', rows.length, all.length);
}

/**
 * The 13 damage types the rules name. A closed list, because it is what stops a sentence from being
 * read as a mechanic it is not: Dragonborn's "Resistance to the damage type determined by your
 * Draconic Ancestry" would otherwise yield a resistance to "the".
 */
const DAMAGE_TYPES = new Set([
	'acid',
	'bludgeoning',
	'cold',
	'fire',
	'force',
	'lightning',
	'necrotic',
	'piercing',
	'poison',
	'psychic',
	'radiant',
	'slashing',
	'thunder',
]);

/**
 * The effect tokens a species' or lineage's own prose states outright.
 *
 * The SRD is prose, so this is the one place allowed to read a mechanic out of a sentence — and it
 * only reads sentences that say exactly one thing about one named damage type. A choice
 * ("Resistance to the damage type determined by…") names none, so it matches nothing. Anything
 * conditional ("Advantage on saving throws you make to avoid or end the Poisoned condition") is
 * likewise left alone: the vocabulary has no gate for it, and an ungated `advantage:save.con` is a
 * different, wrong rule.
 *
 * Callers pass the species' OWN traits with its choice table already removed. A species body embeds
 * that table verbatim, so reading the whole block gives every Elf the Wood Elf's speed and every
 * Tiefling all three legacies at once — each of which the sheet would then apply for real.
 *
 * What is left unextracted is not lost: it is in `text_en`, which the article renders in full.
 */
function effectsFromTraits(text) {
	const tokens = [];
	for (const m of text.matchAll(/You have (Resistance|Immunity|Vulnerability) to (\w+) damage/g)) {
		const type = m[2].toLowerCase();
		if (!DAMAGE_TYPES.has(type)) continue;
		const bucket = { Resistance: 'resist', Immunity: 'immune', Vulnerability: 'vulnerable' }[m[1]];
		tokens.push(`damage_sensitivity:${bucket}:${type}`);
	}
	// "Your Speed increases to 35 feet" — a set, not a bonus, exactly as the sentence says
	for (const m of text.matchAll(/Your Speed increases to (\d+) feet/g))
		tokens.push(`set_override:speed:${m[1]}`);
	return tokens.join(';');
}

/** A species' own prose, with any choice table it embeds taken out — see `effectsFromTraits`. */
const withoutTables = (text) => text.replace(/<table>[\s\S]*?<\/table>/gi, ' ');

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
			effects: effectsFromTraits(withoutTables(text)),
			size: (
				/(tiny|small|medium|large|huge|gargantuan)/i.exec(sizeRaw)?.[1] || 'medium'
			).toLowerCase(),
			speed: parseInt(speedRaw, 10) || 30,
			creature_type: (field(text, 'Creature Type') || '').toLowerCase(),
		};
	});
	writeCsv(
		out('species_srd.csv'),
		[
			'id',
			'systems',
			'source',
			'size',
			'speed',
			'creature_type',
			'effects',
			'name_en',
			'name_uk',
			'text_en',
			'text_uk',
		],
		rows,
	);
	assertCount('species', rows.length, all.length);
}

// --- species options (2024 in-species choices) -------------------------------
// Three SHAPES, because the SRD writes these three ways and flattening them would mean guessing:
//  · a 4-column table (Name · level-1 benefit · spell · spell) — Elf, Tiefling. Name + benefit text,
//    plus whatever `effectsFromTraits` reads out of it (a legacy's resistance, Wood Elf's speed).
//  · a PAIRED 2-column table read across (Dragon · Damage Type, twice per row) — Dragonborn. The
//    species' own Damage Resistance trait says "you have Resistance to the damage type determined by
//    your Draconic Ancestry", so the resistance is the row's, stated by the source and not inferred.
//  · a prose list of `**Name.**` headings — Gnome, Goliath.
// 2024 species carry no ASI, so nothing here is a stat change beyond what the benefit says outright.
// A cantrip or a prepared spell has no token in the vocabulary, so those stay prose.
const SPECIES_CHOICE_2024 = {
	Elf: { kind: 'lineage', label: 'Elven Lineage', shape: 'table4' },
	Tiefling: { kind: 'legacy', label: 'Fiendish Legacy', shape: 'table4' },
	Dragonborn: { kind: 'ancestry', label: 'Draconic Ancestry', shape: 'pairedTable' },
	Gnome: { kind: 'lineage', label: 'Gnomish Lineage', shape: 'proseList' },
	Goliath: { kind: 'ancestry', label: 'Giant Ancestry', shape: 'proseList' },
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
/** `[name, benefitText, effects?]` for one species' choice, per the shape its SRD entry is written
 *  in. A shape that reads the mechanic from a COLUMN hands the token over; the prose shapes leave it
 *  to `effectsFromTraits`, which reads the sentence rather than a sentence this file wrote. */
function speciesChoiceOptions(shape, body) {
	const text = stripHtml(body.join(' '));
	if (shape === 'proseList') {
		// `**Cloud's Jaunt (Cloud Giant).** As a Bonus Action, …` — the heading is the option's name,
		// the sentence after it is the benefit, and the next heading ends it.
		const out = [];
		const re = /\*\*([^*]+?)\.\*\*\s*([\s\S]*?)(?=\*\*[^*]+?\.\*\*|$)/g;
		for (const m of text.matchAll(re)) out.push([m[1].trim(), m[2].trim()]);
		return out;
	}
	const tds = firstTableTds(body);
	if (shape === 'pairedTable') {
		// Dragon · Damage Type, twice across each row — so every EVEN cell is a name and the cell
		// after it is its damage type. The species' Damage Resistance trait is what makes it an effect.
		const out = [];
		for (let i = 0; i + 1 < tds.length; i += 2)
			if (tds[i])
				out.push([
					tds[i],
					`Your Breath Weapon and Damage Resistance are ${tds[i + 1]}.`,
					`damage_sensitivity:resist:${tds[i + 1].toLowerCase()}`,
				]);
		return out;
	}
	const out = [];
	for (let i = 0; i + 1 < tds.length; i += 4) if (tds[i]) out.push([tds[i], tds[i + 1] || '']);
	return out;
}

/** A Giant Ancestry benefit is usable "a number of times equal to your Proficiency Bonus, and you
 *  regain all expended uses when you finish a Long Rest" — one shape, stated once for all eight in
 *  the trait's own lead-in, so the pool is the row's rather than something read out of each line. */
const giantAncestryPool = (id) => `grant_resource:${id}:proficiency_bonus:long`;

function convertSpeciesOptions() {
	const all = blocks(src('character-origins.md')).filter((b) => b.h3 === 'Species Descriptions');
	const rows = [];
	for (const b of all) {
		const ch = SPECIES_CHOICE_2024[b.name];
		if (!ch) continue;
		for (const [name, benefit, tokens] of speciesChoiceOptions(ch.shape, b.body)) {
			const id = slug(`${b.name}-${name}`);
			rows.push({
				id,
				systems: '5.5e',
				source: 'SRD 5.2.1',
				name_en: name,
				name_uk: '',
				text_en: benefit,
				text_uk: '',
				// a shape that KNOWS its token (the ancestry table's damage-type column) states it; the
				// Giant benefits share one pool sentence; everything else is read out of its own prose
				effects:
					tokens ??
					(ch.label === 'Giant Ancestry' ? giantAncestryPool(id) : effectsFromTraits(benefit)),
				species_id: slug(b.name),
				kind: ch.kind,
				option_label: ch.label,
			});
		}
	}
	// 3 Elven Lineages + 3 Fiendish Legacies + 10 Draconic Ancestors + 2 Gnomish + 6 Giant
	assertCount('species_options', rows.length, 24);
	writeCsv(
		out('species_options_srd.csv'),
		[
			'id',
			'systems',
			'source',
			'species_id',
			'kind',
			'option_label',
			'effects',
			'name_en',
			'name_uk',
			'text_en',
			'text_uk',
		],
		rows,
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
			origin_feat: slug(field(text, 'Feat')),
		};
	});
	writeCsv(
		out('backgrounds_srd.csv'),
		[
			'id',
			'systems',
			'source',
			'skills',
			'tools',
			'languages',
			'ability_choices',
			'origin_feat',
			'effects',
			'name_en',
			'name_uk',
			'text_en',
			'text_uk',
		],
		rows,
	);
	assertCount('backgrounds', rows.length, all.length);
}

// --- languages (E1: the 2024 Standard + Rare tables in character-creation.md) -----------------
// SRD 5.2.1 reorganized languages into Standard (10, incl. Common) + Rare (9) and DROPPED the
// per-language "typical speakers" / "script" columns the 2014 tables carried — so those columns are
// emitted blank here (never guessed). The only per-language prose the 2024 table gives is the
// Primordial dialects note, which is carried on that row's text_en.
function convertLanguages() {
	const txt = src('character-creation.md');
	const tableAfter = (marker) => {
		const at = txt.indexOf(marker);
		if (at < 0) throw new Error(`languages: "${marker}" not found in source`);
		const tbl = /<table>([\s\S]*?)<\/table>/i.exec(txt.slice(at));
		if (!tbl) throw new Error(`languages: no <table> after "${marker}"`);
		return [...tbl[1].matchAll(/<td>([\s\S]*?)<\/td>/gi)].map((m) => m[1].trim());
	};
	// Standard rows are [1d12 roll, Language]; keep the language cells (a roll cell is "—" or digits)
	const standard = tableAfter('**Standard Languages**').filter((c) => c && !/^(—|\d)/.test(c));
	// Rare has two Language columns; every non-empty cell is a language name (Primordial carries a *)
	const rare = tableAfter('**Rare Languages**').filter(Boolean);
	const primordialNote = (/\*Primordial includes[^\n]*/.exec(txt)?.[0] ?? '')
		.replace(/^\*/, '')
		.trim();
	const mk = (name, category) => {
		const clean = name.replace(/\*+$/, '').trim(); // strip the Primordial asterisk marker
		return {
			id: slug(clean),
			systems: '5.5e',
			source: 'SRD 5.2.1',
			name_en: clean,
			name_uk: '',
			text_en: /^Primordial/.test(clean) ? primordialNote : '',
			text_uk: '',
			effects: '',
			category, // 2024 uses Standard / Rare (2014 used Standard / Exotic)
			speakers: '', // not in the 2024 source
			script: '', // 2024 dropped per-language scripts
		};
	};
	const rows = [...standard.map((n) => mk(n, 'standard')), ...rare.map((n) => mk(n, 'rare'))];
	assertCount('languages', rows.length, 19); // 10 Standard + 9 Rare (SRD 5.2.1)
	writeCsv(
		out('languages_srd.csv'),
		[
			'id',
			'systems',
			'source',
			'category',
			'speakers',
			'script',
			'effects',
			'name_en',
			'name_uk',
			'text_en',
			'text_uk',
		],
		rows,
	);
}

convertFeats();
convertConditions();
convertSpecies();
convertSpeciesOptions();
convertBackgrounds();
convertLanguages();
console.log('done.');
