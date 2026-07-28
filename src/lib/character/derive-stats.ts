/*
 * Per-stat DERIVATION — the pure stat-phase helpers of deriveSheet, split out of derive.ts. Each
 * takes the shared computed inputs (build / effective scores / level / typed facts) and returns a
 * `Computed` (or a small record) for one facet of the sheet: saves, skills, AC, speed, passives,
 * defenses. No reactivity, no effects gathering — the effect list is already resolved into `facts`.
 */
import {
	savingThrow,
	skillCheck,
	unarmoredAC,
	armoredAC,
	passiveScore,
	abilityModifier,
	type Ability
} from '../rules/core';
import { ABILITIES } from './schema';
import type { Character } from './schema';
import { SKILL_ABILITY, type SkillId } from './skills';
import { applyEffects, matchesTarget, type EffectFacts } from '../effects/apply';
import { computed, type Computed, type Contribution } from '../rules/pipeline';
import type { ContentGraph, LoadedRow, LoadedRowOf } from '../content/loader';

/** Coerce a CSV-derived cell to a number (already-number passes through), else the default. Shared by
 *  the stat helpers + deriveSheet's base-speed read. */
export const num = (v: unknown, d = 0): number => (typeof v === 'number' ? v : Number(v) || d);

/** Skill proficiency level (a level, not two booleans): none → half (Jack of All Trades) →
 *  proficient → expertise (×2). */
export type SkillProficiency = 'none' | 'half' | 'proficient' | 'expertise';
const PROF_ORDER: Record<SkillProficiency, number> = {
	none: 0,
	half: 1,
	proficient: 2,
	expertise: 3
};
/** The higher rung of the proficiency ladder — sources combine by MAX, never by flag-union, so
 *  "expertise without proficiency" is unrepresentable. */
const maxProf = (a: SkillProficiency, b: SkillProficiency): SkillProficiency =>
	PROF_ORDER[a] >= PROF_ORDER[b] ? a : b;

export interface AbilityBlock {
	/** The effective score — traced + clamped through the pipeline (A10), explainable on hover. */
	score: Computed;
	baseScore: number;
	mod: number;
	save: Computed;
}

/** The computed inputs every stat-phase helper reads (bundled so the helpers stay ≤4 params). */
export interface StatInputs {
	build: Character['build'];
	scores: Record<Ability, number>;
	level: number;
	facts: EffectFacts;
}

/** Effect-granted proficiencies split into saves (proficient-or-not) + skills (by ladder level).
 *  `grant_proficiency:[expertise:]<target>` — the parser already stripped any `skill.` prefix; a
 *  save target is `con` / `save.con`; expertise on a save just means proficient (doesn't apply). */
export function gatherGrantedProficiencies(facts: EffectFacts): {
	grantedSaves: Set<Ability>;
	grantedSkills: Map<string, SkillProficiency>;
} {
	const grantedSaves = new Set<Ability>();
	const grantedSkills = new Map<string, SkillProficiency>();
	for (const p of facts.proficiencies) {
		const tgt = p.target.replace(/^save\./, '');
		if ((ABILITIES as readonly string[]).includes(tgt)) grantedSaves.add(tgt as Ability);
		else grantedSkills.set(p.target, maxProf(grantedSkills.get(p.target) ?? 'none', p.level));
	}
	return { grantedSaves, grantedSkills };
}

/** Save-proficient abilities: build.saves + effect-granted + the STARTING class's saves. Multiclass
 *  RAW grants saves from the FIRST class ONLY (A8); the loop still resolves each class row so a
 *  missing ref is flagged, but only classes[0] adds saves. */
export function resolveClassSaves(
	build: Character['build'],
	graph: ContentGraph,
	grantedSaves: Set<Ability>,
	missing: string[]
): Set<Ability> {
	const classSaves = new Set<Ability>([...(build.saves as Ability[]), ...grantedSaves]);
	build.classes.forEach((c, i) => {
		const row = graph.get(c.class);
		if (!row) {
			missing.push(c.class);
			return;
		}
		if (i === 0 && row.type === 'class' && Array.isArray(row.data.saves))
			for (const a of row.data.saves as Ability[]) classSaves.add(a);
	});
	return classSaves;
}

export function deriveAbilityBlocks(
	{ build, scores, level, facts }: StatInputs,
	abilityComputed: Record<Ability, Computed>,
	classSaves: Set<Ability>
): Record<Ability, AbilityBlock> {
	const abilities = {} as Record<Ability, AbilityBlock>;
	for (const ab of ABILITIES) {
		const base = savingThrow({
			ability: ab,
			score: scores[ab],
			level,
			proficient: classSaves.has(ab)
		});
		abilities[ab] = {
			score: abilityComputed[ab],
			baseScore: build.abilities[ab],
			mod: abilityModifier(scores[ab]),
			save: applyEffects(`save.${ab}`, base, facts)
		};
	}
	return abilities;
}

/** Skills: the BUILD's chosen level (expertise requires the chosen proficiency) combines with the
 *  effect-granted level by MAX on the one ladder, so no boolean combination can express an invalid
 *  state. */
export function deriveSkills(
	{ build, scores, level, facts }: StatInputs,
	grantedSkills: Map<string, SkillProficiency>
): Record<SkillId, Computed & { prof: SkillProficiency }> {
	const chosenProf = new Set(build.skills);
	const chosenExpert = new Set(build.expertise ?? []);
	const skills = {} as Record<SkillId, Computed & { prof: SkillProficiency }>;
	for (const [skill, ab] of Object.entries(SKILL_ABILITY) as [SkillId, Ability][]) {
		const chosen: SkillProficiency = chosenProf.has(skill)
			? chosenExpert.has(skill)
				? 'expertise'
				: 'proficient'
			: 'none';
		const profLevel = maxProf(chosen, grantedSkills.get(skill) ?? 'none');
		const base = skillCheck({
			ability: ab,
			score: scores[ab],
			level,
			proficient: profLevel === 'proficient',
			expertise: profLevel === 'expertise',
			halfProficient: profLevel === 'half'
		});
		skills[skill] = { ...applyEffects(`skill.${skill}`, base, facts), prof: profLevel };
	}
	return skills;
}

/** AC: equipped armor (dex-capped) + a raised shield's +2 (the play-state flag, the single source
 *  for it — not the inventory equipped flag), else unarmored; then AC effects fold on top. */
export function deriveAc(
	{ scores, facts }: StatInputs,
	equippedArmor: LoadedRowOf<'item'> | undefined,
	shieldRaised: boolean
): Computed {
	let acBase: Computed;
	if (equippedArmor) {
		const capRaw = equippedArmor.data.armor_dex_cap;
		const dexCap = capRaw === '' || capRaw == null ? null : num(capRaw);
		acBase = armoredAC({ armorBaseAc: num(equippedArmor.data.ac), dexScore: scores.dex, dexCap });
	} else {
		acBase = unarmoredAC({ dexScore: scores.dex });
	}
	if (shieldRaised)
		acBase = {
			...acBase,
			value: acBase.value + 2,
			trace: [...acBase.trace, { source: 'Shield', layer: 'item', op: 'add', amount: 2 }]
		};
	return applyEffects('ac', acBase, facts);
}

/** Speed from species base; A3: armor whose `str_min` exceeds the wearer's STR drops it 10 ft (RAW,
 *  both editions), traced as an item-layer contribution so it's explained; then effects layer on top. */
export function deriveSpeed(
	{ scores, facts }: StatInputs,
	speciesRow: LoadedRow | undefined,
	baseSpeed: number,
	equippedArmor: LoadedRowOf<'item'> | undefined
): Computed {
	const speedBase: Contribution[] = [
		{
			source: speciesRow ? String(speciesRow.data.name_en) : 'Default',
			layer: 'base',
			op: 'add',
			amount: baseSpeed
		}
	];
	const armorStrMin = equippedArmor ? num(equippedArmor.data.str_min) : 0;
	if (armorStrMin > 0 && scores.str < armorStrMin)
		speedBase.push({
			source: `${String(equippedArmor?.data.name_en)} (STR ${armorStrMin})`,
			layer: 'item',
			op: 'add',
			amount: -10,
			note: `STR ${scores.str} < ${armorStrMin}`
		});
	return applyEffects('speed', computed(speedBase, { min: 0 }), facts);
}

/** Passive score of every skill (10 + mod ± adv/dis, `passive.<skill>` effects folded). Any ability
 *  check has a passive form (RAW), and the play view pins arbitrary skills as passive senses. */
export function derivePassives(
	skills: Record<SkillId, Computed & { prof: SkillProficiency }>,
	facts: EffectFacts
): Record<SkillId, Computed> {
	const out = {} as Record<SkillId, Computed>;
	for (const skill of Object.keys(SKILL_ABILITY) as SkillId[]) {
		// advantage/disadvantage on the underlying check moves the passive by ±5 (both → cancel, RAW).
		const adv = facts.advantage.some((a) => matchesTarget(a.target, `skill.${skill}`));
		const dis = facts.disadvantage.some((d) => matchesTarget(d.target, `skill.${skill}`));
		let base = passiveScore(skills[skill]);
		if (adv !== dis)
			base = {
				...base,
				value: base.value + (adv ? 5 : -5),
				trace: [
					...base.trace,
					{
						source: adv ? 'Advantage' : 'Disadvantage',
						layer: 'condition',
						op: 'add',
						amount: adv ? 5 : -5
					}
				]
			};
		out[skill] = applyEffects(`passive.${skill}`, base, facts);
	}
	return out;
}

/** Damage defenses collected from `resist_immune` facts, deduped per bucket. */
export function deriveDefenses(facts: EffectFacts): {
	resist: string[];
	immune: string[];
	vulnerable: string[];
} {
	const defenses = { resist: [] as string[], immune: [] as string[], vulnerable: [] as string[] };
	for (const d of facts.defenses)
		if (!defenses[d.bucket].includes(d.type)) defenses[d.bucket].push(d.type);
	return defenses;
}
