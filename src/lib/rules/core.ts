/*
 * Pure D&D rules math (5e + 5.5e). Framework-agnostic, no Svelte, NO dependency on the
 * effects module. Every derived stat returns a `Computed` ({value, trace, notes}).
 *
 * 5e and 5.5e share these formulas (ability mod, proficiency, saves, skills, passives,
 * spell DCs, AC, HP); the few real divergences (e.g. the 5e-only encumbrance variant) are
 * gated on the `system` argument. Item/feature/condition modifiers are NOT added here —
 * they arrive later through the effects seam.
 */
import { computed, type Computed, type Contribution, type System } from './pipeline';

export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

/** Ability modifier: floor((score − 10) / 2). Defined for scores 1..30. */
export function abilityModifier(score: number): number {
	return Math.floor((score - 10) / 2);
}

/** Proficiency bonus by character level: 2 + floor((level − 1) / 4) → +2..+6. */
export function proficiencyBonus(level: number): number {
	return 2 + Math.floor((Math.max(1, Math.min(20, level)) - 1) / 4);
}

const abilityContribution = (ability: Ability, score: number): Contribution => ({
	source: `${ability.toUpperCase()} mod`,
	layer: 'ability',
	op: 'add',
	amount: abilityModifier(score),
	note: `${ability.toUpperCase()} ${score}`
});

/** A saving throw: ability mod + proficiency (if proficient in that save). */
export function savingThrow(args: {
	ability: Ability;
	score: number;
	level: number;
	proficient: boolean;
}): Computed {
	const c: Contribution[] = [abilityContribution(args.ability, args.score)];
	if (args.proficient) {
		c.push({
			source: 'Proficiency',
			layer: 'proficiency',
			op: 'add',
			amount: proficiencyBonus(args.level)
		});
	}
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
	halfProficient?: boolean;
}): Computed {
	const c: Contribution[] = [abilityContribution(args.ability, args.score)];
	const prof = proficiencyBonus(args.level);
	if (args.expertise) {
		c.push({ source: 'Expertise', layer: 'proficiency', op: 'add', amount: prof * 2 });
	} else if (args.proficient) {
		c.push({ source: 'Proficiency', layer: 'proficiency', op: 'add', amount: prof });
	} else if (args.halfProficient) {
		c.push({
			source: 'Jack of All Trades',
			layer: 'proficiency',
			op: 'add',
			amount: Math.floor(prof / 2)
		});
	}
	return computed(c);
}

/** Passive score = 10 + the check bonus (no roll). Advantage/disadvantage (±5) are effects. */
export function passiveScore(check: Computed): Computed {
	return computed([
		{ source: 'Passive base', layer: 'base', op: 'add', amount: 10 },
		{ source: 'Skill bonus', layer: 'ability', op: 'add', amount: check.value }
	]);
}

/** Initiative = DEX modifier (feats/effects add more later). */
export function initiative(args: { dexScore: number }): Computed {
	return computed([abilityContribution('dex', args.dexScore)]);
}

/** Spell save DC = 8 + proficiency + spellcasting-ability modifier. */
export function spellSaveDC(args: { ability: Ability; score: number; level: number }): Computed {
	return computed([
		{ source: 'Base', layer: 'base', op: 'add', amount: 8 },
		{
			source: 'Proficiency',
			layer: 'proficiency',
			op: 'add',
			amount: proficiencyBonus(args.level)
		},
		abilityContribution(args.ability, args.score)
	]);
}

/** Spell attack bonus = proficiency + spellcasting-ability modifier. */
export function spellAttackBonus(args: {
	ability: Ability;
	score: number;
	level: number;
}): Computed {
	return computed([
		{
			source: 'Proficiency',
			layer: 'proficiency',
			op: 'add',
			amount: proficiencyBonus(args.level)
		},
		abilityContribution(args.ability, args.score)
	]);
}

/** Unarmored AC = 10 + DEX modifier. */
export function unarmoredAC(args: { dexScore: number }): Computed {
	return computed([
		{ source: 'Base', layer: 'base', op: 'add', amount: 10 },
		abilityContribution('dex', args.dexScore)
	]);
}

/** Armored AC = armor base + capped DEX. `dexCap`: null = uncapped (light), 2 = medium,
 *  0 = none (heavy). */
export function armoredAC(args: {
	armorBaseAc: number;
	dexScore: number;
	dexCap: number | null;
}): Computed {
	const dexMod = abilityModifier(args.dexScore);
	const applied = args.dexCap === null ? dexMod : Math.min(dexMod, args.dexCap);
	return computed([
		{ source: 'Armor', layer: 'item', op: 'add', amount: args.armorBaseAc },
		{
			source: 'DEX' + (args.dexCap !== null ? ` (max ${args.dexCap})` : ''),
			layer: 'ability',
			op: 'add',
			amount: applied,
			note: `DEX ${args.dexScore}`
		}
	]);
}

const DIE_MAX: Record<string, number> = { d6: 6, d8: 8, d10: 10, d12: 12 };

/** Max HP for one class (SRD fixed values): level 1 = die max + CON; each later level =
 *  (die average, rounded up) + CON. Multiclass callers sum per-class results. */
export function maxHpForClass(args: { hitDie: string; level: number; conScore: number }): Computed {
	const max = DIE_MAX[args.hitDie];
	if (!max) throw new Error(`unknown hit die: ${args.hitDie}`);
	const conMod = abilityModifier(args.conScore);
	const avgUp = max / 2 + 1; // d6→4, d8→5, d10→6, d12→7
	const laterLevels = Math.max(0, args.level - 1);
	const c: Contribution[] = [
		{ source: `${args.hitDie} (level 1)`, layer: 'base', op: 'add', amount: max }
	];
	if (laterLevels > 0) {
		c.push({
			source: `avg ${avgUp} × ${laterLevels}`,
			layer: 'base',
			op: 'add',
			amount: avgUp * laterLevels
		});
	}
	c.push({
		source: `CON × ${args.level}`,
		layer: 'ability',
		op: 'add',
		amount: conMod * args.level,
		note: `CON ${args.conScore}`
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
	const notes =
		args.system === '5e'
			? [
					`Encumbered at ${args.strScore * 5} lb (−10 ft)`,
					`Heavily encumbered at ${args.strScore * 10} lb (−20 ft)`
				]
			: ['Over capacity → speed 5 ft'];
	return computed(
		[
			{
				source: 'STR × 15',
				layer: 'base',
				op: 'add',
				amount: args.strScore * 15,
				note: `STR ${args.strScore}`
			}
		],
		undefined,
		notes
	);
}
