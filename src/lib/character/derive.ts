/*
 * The aggregator: character + loaded content + rules core + effects engine → the full set
 * of derived stats a sheet renders. One call, `deriveSheet(character, graph)`.
 *
 * This is the glue seam — it resolves the character's `type:source:id` refs against the
 * content graph, runs the pure rules math on the resulting numbers, and layers active
 * effects through `applyEffects`. Ability-score bonuses (e.g. a species +2 CON) cascade
 * FIRST (score → modifier → everything downstream); flat stat bonuses (AC, saves, …) layer
 * per-stat after. Missing referenced content is skipped gracefully (loader already flagged
 * it) — the sheet computes with what it can.
 *
 * Every field is a `Computed` ({value, trace, notes}), so the UI explains any number.
 */
import type { ContentGraph, LoadedRow } from '../content/loader';
import type { Character } from './schema';
import { ABILITIES } from './schema';
import {
	abilityModifier,
	proficiencyBonus,
	savingThrow,
	skillCheck,
	passiveScore,
	initiative as initiativeOf,
	unarmoredAC,
	armoredAC,
	maxHpForClass,
	carryingCapacity,
	type Ability
} from '../rules/core';
import { applyEffects, type ActiveEffect } from '../effects/index';
import { deriveSpellcasting, type Spellcasting } from './spellcasting';
import type { Computed, System } from '../rules/pipeline';

/** Skill → its governing ability (the 18 SRD skills). */
export const SKILL_ABILITY: Record<string, Ability> = {
	acrobatics: 'dex',
	'animal-handling': 'wis',
	arcana: 'int',
	athletics: 'str',
	deception: 'cha',
	history: 'int',
	insight: 'wis',
	intimidation: 'cha',
	investigation: 'int',
	medicine: 'wis',
	nature: 'int',
	perception: 'wis',
	performance: 'cha',
	persuasion: 'cha',
	religion: 'int',
	'sleight-of-hand': 'dex',
	stealth: 'dex',
	survival: 'wis'
};

export interface AbilityBlock {
	score: number;
	baseScore: number;
	mod: number;
	save: Computed;
}

export interface CharacterSheet {
	level: number;
	proficiencyBonus: number;
	abilities: Record<Ability, AbilityBlock>;
	skills: Record<string, Computed & { proficient: boolean }>;
	ac: Computed;
	initiative: Computed;
	speed: Computed;
	maxHp: Computed;
	passives: Record<'perception' | 'investigation' | 'insight', Computed>;
	carryingCapacity: Computed;
	/** Per-class casting profiles + shared/pact slot pools (empty classes = non-caster). */
	spellcasting: Spellcasting;
	/** Content refs the character points at that the graph couldn't resolve. */
	missing: string[];
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' ? v : Number(v) || d);
const tokensOf = (row: LoadedRow | undefined): string[] =>
	Array.isArray(row?.data.effects) ? (row!.data.effects as string[]) : [];

/** Gather every active effect (species/items/runtime) as {source, layer, tokens}. */
function gatherEffects(
	character: Character,
	graph: ContentGraph,
	missing: string[]
): ActiveEffect[] {
	const active: ActiveEffect[] = [];
	const resolve = (ref: string | undefined) => {
		if (!ref) return undefined;
		const row = graph.get(ref);
		if (!row) missing.push(ref);
		return row;
	};

	const species = resolve(character.build.species);
	if (species)
		active.push({
			source: String(species.data.name_en),
			layer: 'feature',
			tokens: tokensOf(species)
		});

	const background = resolve(character.build.background);
	if (background && tokensOf(background).length)
		active.push({
			source: String(background.data.name_en),
			layer: 'feature',
			tokens: tokensOf(background)
		});

	// feats (incl. repeatable ones taken more than once → their effect applies each time)
	for (const featRef of character.build.feats) {
		const feat = resolve(featRef);
		const toks = tokensOf(feat);
		if (feat && toks.length)
			active.push({ source: String(feat.data.name_en), layer: 'feature', tokens: toks });
	}

	for (const inv of character.build.inventory) {
		if (!inv.equipped && !inv.attuned) continue;
		const item = resolve(inv.item);
		const toks = tokensOf(item);
		if (item && toks.length)
			active.push({ source: String(item.data.name_en), layer: 'item', tokens: toks });
	}

	for (const eff of character.play.effects) {
		if (eff.effects.length)
			active.push({ source: eff.label, layer: 'condition', tokens: eff.effects });
	}
	return active;
}

/** Sum flat-bonus tokens that target a given ability score (the cascade layer). */
function abilityBonus(active: ActiveEffect[], ability: Ability): number {
	let sum = 0;
	for (const eff of active) {
		for (const t of eff.tokens) {
			const m = new RegExp(`^flat-bonus:${ability}([+-]\\d+)$`, 'i').exec(t.trim());
			if (m) sum += Number(m[1]);
		}
	}
	return sum;
}

export function deriveSheet(character: Character, graph: ContentGraph): CharacterSheet {
	const build = character.build;
	const system = character.system as System;
	const missing: string[] = [];
	const active = gatherEffects(character, graph, missing);

	const level = build.classes.reduce((n, c) => n + c.level, 0) || 1;
	const prof = proficiencyBonus(level);

	// effective ability scores (base + allocated boosts + score-targeting effects), downstream
	const scores = {} as Record<Ability, number>;
	for (const ab of ABILITIES)
		scores[ab] = build.abilities[ab] + (build.abilityBoosts?.[ab] ?? 0) + abilityBonus(active, ab);

	// saves: proficient if the ability is in build.saves (or any class's saves)
	const classSaves = new Set(build.saves as Ability[]);
	for (const c of build.classes) {
		const row = graph.get(c.class);
		if (!row) missing.push(c.class);
		const s = row?.data.saves;
		if (Array.isArray(s)) for (const a of s) classSaves.add(a as Ability);
	}

	const abilities = {} as Record<Ability, AbilityBlock>;
	for (const ab of ABILITIES) {
		const base = savingThrow({
			ability: ab,
			score: scores[ab],
			level,
			proficient: classSaves.has(ab)
		});
		abilities[ab] = {
			score: scores[ab],
			baseScore: build.abilities[ab],
			mod: abilityModifier(scores[ab]),
			save: applyEffects(`save.${ab}`, base, active)
		};
	}

	// skills
	const skillProf = new Set(build.skills);
	const skills = {} as Record<string, Computed & { proficient: boolean }>;
	for (const [skill, ab] of Object.entries(SKILL_ABILITY)) {
		const proficient = skillProf.has(skill);
		const base = skillCheck({ ability: ab, score: scores[ab], level, proficient });
		skills[skill] = { ...applyEffects(`skill.${skill}`, base, active), proficient };
	}

	// AC: equipped armor + shield, else unarmored; then effects
	let acBase: Computed;
	const armor = build.inventory
		.map((i) => (i.equipped ? graph.get(i.item) : undefined))
		.find((r) => r?.type === 'item' && r.data.category === 'armor');
	if (armor) {
		const capRaw = armor.data.armor_dex_cap;
		const dexCap = capRaw === '' || capRaw == null ? null : num(capRaw);
		acBase = armoredAC({ armorBaseAc: num(armor.data.ac), dexScore: scores.dex, dexCap });
	} else {
		acBase = unarmoredAC({ dexScore: scores.dex });
	}
	const hasShield = build.inventory.some(
		(i) => i.equipped && graph.get(i.item)?.data.category === 'shield'
	);
	if (hasShield)
		acBase = {
			...acBase,
			value: acBase.value + 2,
			trace: [...acBase.trace, { source: 'Shield', layer: 'item', op: 'add', amount: 2 }]
		};
	const ac = applyEffects('ac', acBase, active);

	// HP: sum per class (SRD fixed); CON uses effective score
	const hpContribs = build.classes.map((c) => {
		const row = graph.get(c.class);
		const hitDie = String(row?.data.hit_die || 'd8');
		return maxHpForClass({ hitDie, level: c.level, conScore: scores.con });
	});
	const maxHp: Computed = hpContribs.length
		? {
				value: hpContribs.reduce((n, h) => n + h.value, 0),
				trace: hpContribs.flatMap((h) => h.trace)
			}
		: maxHpForClass({ hitDie: 'd8', level, conScore: scores.con });

	// speed from species
	const speciesRow = build.species ? graph.get(build.species) : undefined;
	const speed = applyEffects(
		'speed',
		{
			value: num(speciesRow?.data.speed, 30),
			trace: [
				{
					source: speciesRow ? String(speciesRow.data.name_en) : 'Default',
					layer: 'base',
					op: 'add',
					amount: num(speciesRow?.data.speed, 30)
				}
			]
		},
		active
	);

	const passiveOf = (skill: 'perception' | 'investigation' | 'insight') =>
		passiveScore(skills[skill]);

	// spellcasting: per-class profiles + shared/pact slot pools (fixes multiclass DCs, L11)
	const spellcasting = deriveSpellcasting(character, graph, scores);

	return {
		level,
		proficiencyBonus: prof,
		abilities,
		skills,
		ac,
		initiative: applyEffects('initiative', initiativeOf({ dexScore: scores.dex }), active),
		speed,
		maxHp,
		passives: {
			perception: passiveOf('perception'),
			investigation: passiveOf('investigation'),
			insight: passiveOf('insight')
		},
		carryingCapacity: carryingCapacity({ strScore: scores.str, system }),
		spellcasting,
		missing
	};
}
