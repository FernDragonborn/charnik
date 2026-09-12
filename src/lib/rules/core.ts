/*
 * Pure D&D rules math (5e + 5.5e). Framework-agnostic, no Svelte, NO dependency on the
 * effects module. Every derived stat returns a `Computed` ({value, trace, notes}).
 *
 * 5e and 5.5e share these formulas (ability mod, proficiency, saves, skills, passives,
 * spell DCs, AC, HP); the few real divergences (e.g. the 5e-only encumbrance variant) are
 * gated on the `system` argument. Item/feature/condition modifiers are NOT added here —
 * they arrive later through the effects seam.
 */
import {
	computed,
	NOTE_KEY,
	SOURCE_KEY,
	type Computed,
	type Contribution,
	type Layer,
	type Note,
	type System,
} from './pipeline';

/** The six ability ids — the ONE owning list (AUDIT F3); derive, don't re-declare. */
export const ABILITY_IDS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type Ability = (typeof ABILITY_IDS)[number];

/** Creature sizes, smallest→largest (an ORDERED ladder — L2 `size` compares by ordinal). */
export const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const;

/** Armor weight classes ('none' = unarmored). Unordered in rules terms (L2 allows only ==/!=). */
export const ARMOR_TYPES = ['none', 'light', 'medium', 'heavy'] as const;
export type ArmorType = (typeof ARMOR_TYPES)[number];

/** Ability modifier: floor((score − 10) / 2). Defined for scores 1..30. */
export function abilityModifier(score: number): number {
	return Math.floor((score - 10) / 2);
}

/** Hard cap an effective ability score folds to: 30 is the ceiling both editions share; 0 floors a
 *  fully-drained score. A CORE rule (not an effects concern) — it clamps abilities whether the
 *  effects engine is on, off, or removed, so it lives here and the effects fold pipeline imports it. */
export const ABILITY_SCORE_CLAMP = { min: 0, max: 30 } as const;

/** Proficiency bonus by character level: 2 + floor((level − 1) / 4) → +2..+6. */
export function proficiencyBonus(level: number): number {
	return 2 + Math.floor((Math.max(1, Math.min(20, level)) - 1) / 4);
}

const abilityContribution = (ability: Ability, score: number): Contribution => ({
	source: `${ability.toUpperCase()} mod`,
	layer: 'ability',
	op: 'add',
	amount: abilityModifier(score),
	note: `${ability.toUpperCase()} ${score}`,
	key: SOURCE_KEY.abilityMod(ability),
	noteKey: SOURCE_KEY.abilityScore(ability),
	params: { score },
});

/** A proficiency-layer contribution (Proficiency / Expertise / Jack of All Trades — the source names
 *  the flavour, the amount is the already-computed bonus). The one shape every prof-granting stat pushes. */
const profContribution = (source: string, key: string, amount: number): Contribution => ({
	source,
	layer: 'proficiency',
	op: 'add',
	amount,
	key,
});

/** The flat base-layer contribution a stat starts from (DC base 8, unarmored/armor base 10/…). */
const baseContribution = (amount: number): Contribution => ({
	source: 'Base',
	layer: 'base',
	op: 'add',
	amount,
	key: SOURCE_KEY.base,
});

/** A saving throw: ability mod + proficiency (if proficient in that save). */
export function savingThrow(args: {
	ability: Ability;
	score: number;
	level: number;
	proficient: boolean;
}): Computed {
	const c: Contribution[] = [abilityContribution(args.ability, args.score)];
	if (args.proficient)
		c.push(profContribution('Proficiency', SOURCE_KEY.proficiency, proficiencyBonus(args.level)));
	return computed(c);
}

/** A skill (or ability) check bonus. Expertise doubles proficiency; half-proficiency
 *  (Jack of All Trades) adds floor(prof/2) when not otherwise proficient. */
export function skillCheck(args: {
	ability: Ability;
	score: number;
	level: number;
	proficient?: boolean;
	expertise?: boolean;
	partialProficiency?: boolean;
}): Computed {
	const c: Contribution[] = [abilityContribution(args.ability, args.score)];
	const prof = proficiencyBonus(args.level);
	if (args.expertise) c.push(profContribution('Expertise', SOURCE_KEY.expertise, prof * 2));
	else if (args.proficient) c.push(profContribution('Proficiency', SOURCE_KEY.proficiency, prof));
	else if (args.partialProficiency)
		c.push(
			profContribution('Jack of All Trades', SOURCE_KEY.jackOfAllTrades, Math.floor(prof / 2)),
		);
	return computed(c);
}

/** Passive score = 10 + the check bonus (no roll). Advantage/disadvantage (±5) are effects. */
export function passiveScore(check: Computed): Computed {
	return computed([
		{ source: 'Passive base', layer: 'base', op: 'add', amount: 10, key: SOURCE_KEY.passiveBase },
		{
			source: 'Skill bonus',
			layer: 'ability',
			op: 'add',
			amount: check.value,
			key: SOURCE_KEY.skillBonus,
		},
	]);
}

/** Initiative = DEX modifier (feats/effects add more later). */
export function initiative(args: { dexScore: number }): Computed {
	return computed([abilityContribution('dex', args.dexScore)]);
}

/**
 * How many attacks one Attack action makes. RAW everybody starts at one; Extra Attack and its
 * ladder RAISE the number rather than adding to it (`set_override:attacks:<n>:floor`), which is
 * also what keeps a fighter 5 / barbarian 5 at two attacks — RAW, Extra Attack does not stack
 * across classes, and two additive tokens would silently give three.
 */
export function attacksPerAction(): Computed {
	return computed([baseContribution(1)], { min: 1 });
}

/** Spell save DC = 8 + proficiency + spellcasting-ability modifier. */
export function spellSaveDC(args: { ability: Ability; score: number; level: number }): Computed {
	return computed([
		baseContribution(8),
		profContribution('Proficiency', SOURCE_KEY.proficiency, proficiencyBonus(args.level)),
		abilityContribution(args.ability, args.score),
	]);
}

/** Spell attack bonus = proficiency + spellcasting-ability modifier. */
export function spellAttackBonus(args: {
	ability: Ability;
	score: number;
	level: number;
}): Computed {
	return computed([
		profContribution('Proficiency', SOURCE_KEY.proficiency, proficiencyBonus(args.level)),
		abilityContribution(args.ability, args.score),
	]);
}

/** Unarmored AC = 10 + DEX modifier. */
export function unarmoredAC(args: { dexScore: number }): Computed {
	return computed([baseContribution(10), abilityContribution('dex', args.dexScore)]);
}

/** How much of the DEX modifier the armor lets through. Heavy armor (cap 0) ignores DEX ENTIRELY —
 *  no bonus AND no penalty, so a negative mod must not lower AC (RAW, identical in 5e and 5.5e);
 *  `Math.min(dexMod, 0)` would wrongly subtract it. A medium cap bounds the mod from ABOVE only. */
function dexModUnderArmor(dexMod: number, dexCap: number | null): number {
	if (dexCap === null) return dexMod;
	if (dexCap === 0) return 0;
	return Math.min(dexMod, dexCap);
}

/** Armored AC = armor base + capped DEX. `dexCap`: null = uncapped (light), 2 = medium,
 *  0 = none (heavy). */
export function armoredAC(args: {
	armorBaseAc: number;
	dexScore: number;
	dexCap: number | null;
}): Computed {
	const dexMod = abilityModifier(args.dexScore);
	const applied = dexModUnderArmor(dexMod, args.dexCap);
	// the DEX line says which of the three armor cases applied, so a capped or ignored modifier is
	// read off the trace rather than inferred from a number that is smaller than the sheet's
	const dexKey =
		args.dexCap === 0
			? SOURCE_KEY.dexIgnored
			: args.dexCap !== null
				? SOURCE_KEY.dexCapped
				: SOURCE_KEY.dexUnderArmor;
	const dexLabel =
		args.dexCap === 0
			? 'DEX (heavy: ignored)'
			: `DEX${args.dexCap !== null ? ` (max ${args.dexCap})` : ''}`;
	return computed([
		{
			source: 'Armor',
			layer: 'item',
			op: 'add',
			amount: args.armorBaseAc,
			key: SOURCE_KEY.armor,
		},
		{
			source: dexLabel,
			layer: 'ability',
			op: 'add',
			amount: applied,
			note: `DEX ${args.dexScore}`,
			key: dexKey,
			noteKey: SOURCE_KEY.abilityScore('dex'),
			params: { score: args.dexScore, ...(args.dexCap !== null ? { cap: args.dexCap } : {}) },
		},
	]);
}

export const DIE_MAX: Record<string, number> = { d6: 6, d8: 8, d10: 10, d12: 12 };

/** Hit Dice recovered at the end of a LONG rest — an SRD-verified EDITION divergence: 5e (SRD 5.1)
 *  regains half the total (round down, min 1); 5.5e (SRD 5.2.1) regains ALL spent Hit Dice. `total`
 *  is the character's total number of Hit Dice (= total level). Returns the max dice to un-spend. */
export function hitDiceRecoveredOnLongRest(system: System, total: number): number {
	if (total <= 0) return 0;
	return system === '5.5e' ? total : Math.max(1, Math.floor(total / 2));
}

/** HP restored by a `half` short rest (the ½-max-HP house/video-game variant): half the maximum,
 *  rounded down. Not RAW — a per-character opt-in (`ui.shortRestMode === 'half'`). Pure. */
export function shortRestHalfHeal(maxHp: number): number {
	return Math.floor(Math.max(0, maxHp) / 2);
}

/** Max HP for one class (SRD fixed values). The **max hit die** is granted ONCE per character —
 *  for the class taken at CHARACTER level 1; every other level (including the 1st level of a class
 *  multiclassed INTO later) uses the die average rounded up. So only the caller that owns the
 *  character's first level passes `includesCharacterLevel1: true`; every other class passes false
 *  and gets avg-up on all its levels. Rule identical in 5e (PHB'14) and 5.5e (PHB'24) — no system
 *  branch. Multiclass callers sum per-class results. */
export function maxHpForClass(args: {
	hitDie: string;
	level: number;
	conScore: number;
	includesCharacterLevel1: boolean;
}): Computed {
	const max = DIE_MAX[args.hitDie];
	if (!max) throw new Error(`unknown hit die: ${args.hitDie}`);
	const conMod = abilityModifier(args.conScore);
	const avgUp = max / 2 + 1; // d6→4, d8→5, d10→6, d12→7
	const c: Contribution[] = [];
	if (args.includesCharacterLevel1) {
		// this class holds the character's 1st level → that level is the die MAX, the rest are avg
		c.push({
			source: `${args.hitDie} (level 1)`,
			layer: 'base',
			op: 'add',
			amount: max,
			key: SOURCE_KEY.hitDieFirst,
			params: { die: args.hitDie },
		});
		const laterLevels = Math.max(0, args.level - 1);
		if (laterLevels > 0) {
			c.push({
				source: `avg ${avgUp} × ${laterLevels}`,
				layer: 'base',
				op: 'add',
				amount: avgUp * laterLevels,
				key: SOURCE_KEY.hitDieAverage,
				params: { average: avgUp, levels: laterLevels },
			});
		}
	} else if (args.level > 0) {
		// multiclassed into later → EVERY level (incl. this class's 1st) is avg-rounded-up
		c.push({
			source: `avg ${avgUp} × ${args.level}`,
			layer: 'base',
			op: 'add',
			amount: avgUp * args.level,
			key: SOURCE_KEY.hitDieAverage,
			params: { average: avgUp, levels: args.level },
		});
	}
	c.push({
		source: `CON × ${args.level}`,
		layer: 'ability',
		op: 'add',
		amount: conMod * args.level,
		note: `CON ${args.conScore}`,
		key: SOURCE_KEY.conPerLevel,
		noteKey: SOURCE_KEY.abilityScore('con'),
		params: { levels: args.level, score: args.conScore },
	});
	return computed(c, { min: 1 });
}

// prettier-ignore
const FULL_CASTER_SLOTS: number[][] = [
	[2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2],
	[4, 3, 3, 3, 1], [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1],
	[4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
	[4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1],
	[4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1]
];

/** Full-caster spell slots per spell level (index 0 = 1st) at a given caster level. */
export function fullCasterSlots(casterLevel: number): number[] {
	return FULL_CASTER_SLOTS[Math.max(1, Math.min(20, casterLevel)) - 1] ?? [];
}

/** Carrying capacity in pounds = STR × 15. The encumbrance tiers (×5 / ×10) are a 5e-only
 *  variant surfaced as notes; 5.5e just drops speed to 5 ft over capacity. */
export function carryingCapacity(args: { strScore: number; system: System }): Computed {
	const notes: Note[] =
		args.system === '5e'
			? [
					{
						text: `Encumbered at ${args.strScore * 5} lb (−10 ft)`,
						key: NOTE_KEY.encumbered,
						params: { lb: args.strScore * 5 },
					},
					{
						text: `Heavily encumbered at ${args.strScore * 10} lb (−20 ft)`,
						key: NOTE_KEY.heavilyEncumbered,
						params: { lb: args.strScore * 10 },
					},
				]
			: [{ text: 'Over capacity → speed 5 ft', key: NOTE_KEY.overCapacity }];
	return computed(
		[
			{
				source: 'STR × 15',
				layer: 'base',
				op: 'add',
				amount: args.strScore * 15,
				note: `STR ${args.strScore}`,
				key: SOURCE_KEY.carryCapacity,
				noteKey: SOURCE_KEY.abilityScore('str'),
				params: { score: args.strScore },
			},
		],
		undefined,
		notes,
	);
}

/** Effective max HP under an optional manual-max override (A14 — a Free-block affordance).
 *  `manualMax` null → the sheet's fully-computed max. Otherwise the manual value REPLACES the base/
 *  ability layers but hp_max EFFECTS still stack on top (Aid; a 2014-exhaustion `halve`): re-fold
 *  `{Manual max}` (base) + the sheet trace's item/feature/condition/override contributions through
 *  the SAME pipeline, so set/floor/cap/mult semantics survive. Never re-sum from facts (double-count
 *  + a D7 violation) — the effect layers are read straight off `sheetMaxHp.trace`. */
const HP_EFFECT_LAYERS = new Set<Layer>(['item', 'feature', 'condition', 'override']);
export function effectiveHpMax(manualMax: number | null, sheetMaxHp: Computed): number {
	if (manualMax === null) return sheetMaxHp.value;
	const contribs: Contribution[] = [
		{ source: 'Manual max', layer: 'base', op: 'set', amount: manualMax },
		...sheetMaxHp.trace.filter((c) => HP_EFFECT_LAYERS.has(c.layer)),
	];
	return computed(contribs, { min: 1 }).value;
}
