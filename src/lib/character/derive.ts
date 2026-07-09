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
import type { ContentGraph, LoadedRow, LoadedRowOf } from '../content/loader';
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
import {
	applyEffects,
	collectResources,
	parseEffect,
	EFFECT_KIND,
	type ActiveEffect,
	type ResourceDef
} from '../effects/index';
import { deriveSpellcasting, type Spellcasting } from './spellcasting';
import type { Computed, System } from '../rules/pipeline';

/** Skill → its governing ability (the 18 SRD skills). */
// `as const satisfies` so the KEYS form the `SkillId` union (not widened to `string`) while the
// values are still checked to be `Ability`. This lets the skills map be keyed by `SkillId`, so
// indexing it with a known skill id is sound (no `T | undefined`, no non-null assertions).
export const SKILL_ABILITY = {
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
} as const satisfies Record<string, Ability>;

/** The 18 SRD skill ids. */
export type SkillId = keyof typeof SKILL_ABILITY;

/** Skill proficiency level (a level, not two booleans): none → half (Jack of All Trades) →
 *  proficient → expertise (×2). */
export const SKILL_PROFICIENCY = ['none', 'half', 'proficient', 'expertise'] as const;
export type SkillProficiency = (typeof SKILL_PROFICIENCY)[number];

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
	skills: Record<SkillId, Computed & { prof: SkillProficiency }>;
	ac: Computed;
	initiative: Computed;
	speed: Computed;
	maxHp: Computed;
	passives: Record<'perception' | 'investigation' | 'insight', Computed>;
	carryingCapacity: Computed;
	/** Damage resistances / immunities / vulnerabilities from active effects (by type). */
	defenses: { resist: string[]; immune: string[]; vulnerable: string[] };
	/** Trackable resource pools (rage, ki, item N/day…) from `grant-resource` effects. */
	resources: ResourceDef[];
	/** Per-class casting profiles + shared/pact slot pools (empty classes = non-caster). */
	spellcasting: Spellcasting;
	/** Content refs the character points at that the graph couldn't resolve. */
	missing: string[];
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' ? v : Number(v) || d);
const tokensOf = (row: LoadedRow | undefined): string[] => {
	// `effects` rides on every browsable type but not the lookup tables; read it only where present
	const effects = row && 'effects' in row.data ? row.data.effects : undefined;
	return Array.isArray(effects) ? effects : [];
};

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

	// species sub-option (subrace / lineage) — its ASI + traits cascade like the species' own
	const speciesOption = resolve(character.build.speciesOption);
	if (speciesOption && tokensOf(speciesOption).length)
		active.push({
			source: String(speciesOption.data.name_en),
			layer: 'feature',
			tokens: tokensOf(speciesOption)
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

	// expand `apply-condition:<id>` → the referenced condition's OWN effect tokens, so a spell/effect
	// that inflicts a condition actually applies that condition's mechanics (nested one level).
	for (const eff of [...active]) {
		for (const t of eff.tokens) {
			const p = parseEffect(t);
			if (p.kind !== EFFECT_KIND.applyCondition || !p.target) continue;
			const condId = p.target.trim();
			const cond = graph.rows.find((r) => r.type === 'condition' && r.id === condId);
			const toks = tokensOf(cond);
			if (cond && toks.length)
				active.push({
					source: `${eff.source} → ${cond.data.name_en}`,
					layer: 'condition',
					tokens: toks
				});
		}
	}
	return active;
}

/** Sum flat-bonus tokens that target a given ability score (the cascade layer). */
function abilityBonus(active: ActiveEffect[], ability: Ability): number {
	let sum = 0;
	for (const eff of active) {
		for (const t of eff.tokens) {
			const p = parseEffect(t);
			if (p.kind === EFFECT_KIND.flatBonus && p.target === ability && p.amount !== undefined)
				sum += p.amount;
		}
	}
	return sum;
}

export function deriveSheet(character: Character, graph: ContentGraph): CharacterSheet {
	const build = character.build;
	const system = character.system as System;
	const missing: string[] = [];
	// effects-auto global toggle: off → no effect layers (base stats / text only)
	const active = character.play.autoCalc ? gatherEffects(character, graph, missing) : [];

	const level = build.classes.reduce((n, c) => n + c.level, 0) || 1;
	const prof = proficiencyBonus(level);

	// effective ability scores (base + allocated boosts + score-targeting effects), downstream
	const scores = {} as Record<Ability, number>;
	for (const ab of ABILITIES)
		scores[ab] = build.abilities[ab] + (build.abilityBoosts?.[ab] ?? 0) + abilityBonus(active, ab);

	// proficiencies granted by effects (item/feat/feature): `grant-proficiency:<target>` where
	// target is a save (`con` / `save.con`) or a skill id (`stealth`). Collected once, unioned below.
	const grantedSaves = new Set<Ability>();
	const grantedSkills = new Set<string>();
	if (character.play.autoCalc)
		for (const eff of active)
			for (const t of eff.tokens) {
				const p = parseEffect(t);
				if (p.kind !== EFFECT_KIND.grantProficiency || !p.target) continue;
				const raw = p.target.trim();
				const tgt = raw.replace(/^save\./, '');
				if ((ABILITIES as readonly string[]).includes(tgt)) grantedSaves.add(tgt as Ability);
				else grantedSkills.add(raw);
			}

	// saves: proficient if the ability is in build.saves (or any class's saves), or effect-granted
	const classSaves = new Set<Ability>([...(build.saves as Ability[]), ...grantedSaves]);
	for (const c of build.classes) {
		const row = graph.get(c.class);
		if (!row) missing.push(c.class);
		const s = row?.type === 'class' ? row.data.saves : undefined;
		if (Array.isArray(s)) for (const a of s) classSaves.add(a);
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

	// skills (expertise doubles proficiency — Rogue/Bard); effect-granted proficiencies union in
	const skillProf = new Set([...build.skills, ...grantedSkills]);
	const skillExpert = new Set(build.expertise ?? []);
	const skills = {} as Record<SkillId, Computed & { prof: SkillProficiency }>;
	for (const [skill, ab] of Object.entries(SKILL_ABILITY) as [SkillId, Ability][]) {
		const proficient = skillProf.has(skill);
		const expertise = proficient && skillExpert.has(skill);
		const base = skillCheck({ ability: ab, score: scores[ab], level, proficient, expertise });
		const prof: SkillProficiency = expertise ? 'expertise' : proficient ? 'proficient' : 'none';
		skills[skill] = { ...applyEffects(`skill.${skill}`, base, active), prof };
	}

	// AC: equipped armor + shield, else unarmored; then effects
	let acBase: Computed;
	const armor = build.inventory
		.map((i) => (i.equipped ? graph.get(i.item) : undefined))
		.find((r): r is LoadedRowOf<'item'> => r?.type === 'item' && r.data.category === 'armor');
	if (armor) {
		const capRaw = armor.data.armor_dex_cap;
		const dexCap = capRaw === '' || capRaw == null ? null : num(capRaw);
		acBase = armoredAC({ armorBaseAc: num(armor.data.ac), dexScore: scores.dex, dexCap });
	} else {
		acBase = unarmoredAC({ dexScore: scores.dex });
	}
	// shield = the play-state raised flag (the dedicated combat toggle), the single source for its
	// +2 — not the inventory equipped flag (which just says the character owns/wears one)
	if (character.play.shieldRaised)
		acBase = {
			...acBase,
			value: acBase.value + 2,
			trace: [...acBase.trace, { source: 'Shield', layer: 'item', op: 'add', amount: 2 }]
		};
	const ac = applyEffects('ac', acBase, active);

	// HP: sum per class (SRD fixed); CON uses effective score
	const hpContribs = build.classes.map((c) => {
		const row = graph.get(c.class);
		const hitDie = String((row?.type === 'class' ? row.data.hit_die : undefined) || 'd8');
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
	const speciesSpeed = speciesRow?.type === 'species' ? speciesRow.data.speed : undefined;
	const speed = applyEffects(
		'speed',
		{
			value: num(speciesSpeed, 30),
			trace: [
				{
					source: speciesRow ? String(speciesRow.data.name_en) : 'Default',
					layer: 'base',
					op: 'add',
					amount: num(speciesSpeed, 30)
				}
			]
		},
		active
	);

	const passiveOf = (skill: 'perception' | 'investigation' | 'insight') =>
		passiveScore(skills[skill]);

	// damage defenses from effects: `resist-immune:<resist|immune|vulnerable>:<type>` (a bare
	// `resist-immune:<type>` defaults to resistance).
	const defenses = { resist: [] as string[], immune: [] as string[], vulnerable: [] as string[] };
	if (character.play.autoCalc)
		for (const eff of active)
			for (const t of eff.tokens) {
				const p = parseEffect(t);
				if (p.kind !== EFFECT_KIND.resistImmune || !p.target) continue;
				const bucket = p.defense ?? 'resist';
				const type = p.target.trim();
				if (!defenses[bucket].includes(type)) defenses[bucket].push(type);
			}

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
		defenses,
		resources: character.play.autoCalc ? collectResources(active) : [],
		spellcasting,
		missing
	};
}
