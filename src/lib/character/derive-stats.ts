/*
 * Per-stat DERIVATION — the pure stat-phase helpers of deriveSheet, split out of derive.ts. Each
 * takes the shared computed inputs (build / effective scores / level / typed facts) and returns a
 * `Computed` (or a small record) for one facet of the sheet: saves, skills, AC, speed, passives,
 * damage sensitivities. No reactivity, no effects gathering — the effect list is already resolved into `facts`.
 */
import { recordOf } from '../util/records';
import {
	savingThrow,
	skillCheck,
	unarmoredAC,
	armoredAC,
	passiveScore,
	abilityModifier,
	type Ability,
} from '../rules/core';
import { ABILITIES } from './schema';
import type { Character } from './schema';
import { SKILL_ABILITY, type SkillId } from './skills';
import { applyEffects, matchesTarget, type EffectFacts } from '../effects/apply';
import { computed, SOURCE_KEY, type Computed, type Contribution } from '../rules/pipeline';
import { rowName, type ContentGraph, type LoadedRow } from '../content/loader';
import { tagInt, ITEM_TAG } from '../content/item-tags';
import type { ResolvedItem } from '../content/resolved-item';

/** Coerce a CSV-derived cell to a number (already-number passes through), else the default. Shared by
 *  the stat helpers + deriveSheet's base-speed read. */
export const num = (v: unknown, d = 0): number => (typeof v === 'number' ? v : Number(v) || d);

/** Skill proficiency level (a rung, not two booleans): none → partial (Jack of All Trades) →
 *  proficient → expertise (×2). `partial` rather than `half`: a rung is written BEFORE its target in
 *  a token, so `half:skills` reads as "half the skills", and "half" reads as a reduction when this
 *  rung is a GAIN — a lesser proficiency, not a cut-down one. */
export type SkillProficiency = 'none' | 'partial' | 'proficient' | 'expertise';
/** The ladder as a number, so two proficiencies can be compared — shared with the builder's diff,
 *  which reads a change in rank as better or worse. */
export const PROF_ORDER: Record<SkillProficiency, number> = {
	none: 0,
	partial: 1,
	proficient: 2,
	expertise: 3,
};
/** The higher rung of the proficiency ladder — sources combine by MAX, never by flag-union, so
 *  "expertise without proficiency" is unrepresentable. */
const maxProf = (a: SkillProficiency, b: SkillProficiency): SkillProficiency =>
	PROF_ORDER[a] >= PROF_ORDER[b] ? a : b;

export interface AbilityBlock {
	/** The effective score — traced + clamped through the pipeline (A10), explainable on hover. */
	score: Computed;
	baseScore: number;
	/** The raw ability modifier — what damage, a spell DC and a weapon's to-hit are built from. NOT
	 *  what a bare ability check rolls: that is `check`, the folded one. */
	mod: number;
	/** A BARE ability check (the tile's own tap), folded under `check.<ab>` so a `d20_tests` or
	 *  `ability_checks` effect reaches it the way it reaches the save and the skills. */
	check: Computed;
	save: Computed;
	/** Is this save proficient? A VALUE, because the UI used to answer it by sniffing the trace for a
	 *  `layer === 'proficiency'` contribution — reaching into the stacking algebra, which
	 *  `docs/internals/compatibility.md` §1 names as the one shared vessel nothing outside the engine may
	 *  pattern-match on (a family-B system has no such layer and the tile would silently go blank).
	 *  It costs nothing: the answer is already in hand where the save is built. */
	saveProficient: boolean;
}

/** The computed inputs every stat-phase helper reads (bundled so the helpers stay ≤4 params). */
export interface StatInputs {
	build: Character['build'];
	scores: Record<Ability, number>;
	level: number;
	facts: EffectFacts;
}

/** The prefixes that make a `grant_proficiency` target EQUIPMENT rather than a save or a skill —
 *  `armor.heavy` (Life Domain), `weapon.martial`, `weapon.warhammer` (Dwarven Combat Training). */
const EQUIPMENT_PREFIX = { armor: 'armor.', weapon: 'weapon.' } as const;

/** The group targets that mean every save, or every skill, at once. */
const ALL_SAVES = 'saves';
const ALL_SKILLS = 'skills';

/** Effect-granted proficiencies split into saves (proficient-or-not) + skills (by ladder level).
 *  `grant_proficiency:[expertise:]<target>` — the parser already stripped any `skill.` prefix; a
 *  save target is `con` / `save.con`; expertise on a save just means proficient (doesn't apply).
 *  Equipment targets are NOT skills and are picked off first — `grantedEquipmentProfs` reads them. */
export function gatherGrantedProficiencies(facts: EffectFacts): {
	grantedSaves: Set<Ability>;
	grantedSkills: Map<string, SkillProficiency>;
} {
	const grantedSaves = new Set<Ability>();
	const grantedSkills = new Map<string, SkillProficiency>();
	for (const p of facts.proficiencies) {
		if (isEquipmentTarget(p.target)) continue;
		// "proficiency in ALL saving throws" (Diamond Soul) is one statement in the rules, so it is one
		// token here rather than six — spelling out the six would be data the source does not have.
		if (p.target === ALL_SAVES) {
			for (const a of ABILITIES) grantedSaves.add(a);
			continue;
		}
		// "a rung on every skill" (Jack of All Trades' half) is ONE token; the rungs combine by max
		// below, so a skill already proficient keeps proficiency — RAW's "that doesn't already
		// include your proficiency bonus", without a second rule to say it.
		const targets =
			p.target === ALL_SKILLS ? Object.keys(SKILL_ABILITY) : [p.target.replace(/^save\./, '')];
		for (const tgt of targets) {
			if ((ABILITIES as readonly string[]).includes(tgt)) grantedSaves.add(tgt as Ability);
			else grantedSkills.set(tgt, maxProf(grantedSkills.get(tgt) ?? 'none', p.level));
		}
	}
	return { grantedSaves, grantedSkills };
}

const isEquipmentTarget = (target: string): boolean =>
	target.startsWith(EQUIPMENT_PREFIX.armor) || target.startsWith(EQUIPMENT_PREFIX.weapon);

/** Armor / weapon proficiencies a FEATURE granted, as the bare categories or weapon ids
 *  `rules/proficiency` matches equipment against. Binary, not a ladder: there is no expertise in
 *  wearing plate. Read straight off the facts, so the sheet, the attacks panel and the builder's
 *  read-out all answer from the same list. */
export function grantedEquipmentProfs(facts: EffectFacts): { armor: string[]; weapons: string[] } {
	const armor: string[] = [];
	const weapons: string[] = [];
	for (const p of facts.proficiencies) {
		if (p.target.startsWith(EQUIPMENT_PREFIX.armor))
			armor.push(p.target.slice(EQUIPMENT_PREFIX.armor.length));
		else if (p.target.startsWith(EQUIPMENT_PREFIX.weapon))
			weapons.push(p.target.slice(EQUIPMENT_PREFIX.weapon.length));
	}
	return { armor, weapons };
}

/** Save-proficient abilities: build.saves + effect-granted + the STARTING class's saves. Multiclass
 *  RAW grants saves from the FIRST class ONLY (A8); the loop still resolves each class row so a
 *  missing ref is flagged, but only classes[0] adds saves. */
export function resolveClassSaves(
	build: Character['build'],
	graph: ContentGraph,
	grantedSaves: Set<Ability>,
	missing: string[],
): Set<Ability> {
	const classSaves = new Set<Ability>([...build.saves, ...grantedSaves]);
	build.classes.forEach((c, i) => {
		const row = graph.get(c.class);
		if (!row) {
			missing.push(c.class);
			return;
		}
		if (i === 0 && row.type === 'class' && Array.isArray(row.data.saves))
			for (const a of row.data.saves) classSaves.add(a);
	});
	return classSaves;
}

export function deriveAbilityBlocks(
	{ build, scores, level, facts }: StatInputs,
	abilityComputed: Record<Ability, Computed>,
	classSaves: Set<Ability>,
): Record<Ability, AbilityBlock> {
	return recordOf(ABILITIES, (ab) => {
		const proficient = classSaves.has(ab);
		const base = savingThrow({ ability: ab, score: scores[ab], level, proficient });
		return {
			score: abilityComputed[ab],
			baseScore: build.abilities[ab],
			mod: abilityModifier(scores[ab]),
			check: applyEffects(
				`check.${ab}`,
				skillCheck({ ability: ab, score: scores[ab], level }),
				facts,
			),
			save: applyEffects(`save.${ab}`, base, facts),
			saveProficient: proficient,
		};
	});
}

/** Skills: the BUILD's chosen level (expertise requires the chosen proficiency) combines with the
 *  effect-granted level by MAX on the one ladder, so no boolean combination can express an invalid
 *  state. */
export function deriveSkills(
	{ build, scores, level, facts }: StatInputs,
	grantedSkills: Map<string, SkillProficiency>,
): Record<SkillId, Computed & { prof: SkillProficiency }> {
	// class/background picks + §C feat-granted skill choices (Skilled) — both are plain proficiency
	const chosenProf = new Set([...build.skills, ...(build.featSkills ?? [])]);
	const chosenExpert = new Set(build.expertise ?? []);
	// expertise only counts on a skill the build is also proficient in
	function chosenProficiency(skill: SkillId): SkillProficiency {
		if (!chosenProf.has(skill)) return 'none';
		return chosenExpert.has(skill) ? 'expertise' : 'proficient';
	}
	return recordOf(Object.keys(SKILL_ABILITY) as SkillId[], (skill) => {
		const ab = SKILL_ABILITY[skill];
		const profLevel = maxProf(chosenProficiency(skill), grantedSkills.get(skill) ?? 'none');
		const base = skillCheck({
			ability: ab,
			score: scores[ab],
			level,
			proficient: profLevel === 'proficient',
			expertise: profLevel === 'expertise',
			partialProficiency: profLevel === 'partial',
		});
		return { ...applyEffects(`skill.${skill}`, base, facts), prof: profLevel };
	});
}

/** AC: equipped armor (dex-capped) + the shield in hand, else unarmored; then AC effects fold on top.
 *  The shield's contribution follows what is EQUIPPED, because that is the only condition 5e puts on
 *  it — there is no action for raising one, and a shield you are holding is worth its AC while you
 *  hold it. Its own `ac` tag is the amount, so a +1 shield is worth 3 rather than a flat 2, and a
 *  shield row that declares no `ac` contributes nothing — the same rule armour follows. */
export function deriveAc(
	{ scores, facts }: StatInputs,
	equippedArmor: ResolvedItem | undefined,
	equippedShield: ResolvedItem | undefined,
): Computed {
	let acBase: Computed;
	if (equippedArmor) {
		// no `dex_cap` tag means no cap (light armor), which is NOT `dex_cap:0` (heavy) — hence null
		const dexCap = tagInt(equippedArmor.tags, ITEM_TAG.dexCap);
		const armorBaseAc = tagInt(equippedArmor.tags, ITEM_TAG.ac) ?? 0;
		acBase = armoredAC({ armorBaseAc, dexScore: scores.dex, dexCap });
	} else {
		acBase = unarmoredAC({ dexScore: scores.dex });
	}
	if (equippedShield) {
		// its own `ac` tag, exactly like armour above — a shield row that does not declare one
		// contributes nothing rather than a number we made up for it
		const shieldAc = tagInt(equippedShield.tags, ITEM_TAG.ac) ?? 0;
		acBase = {
			...acBase,
			value: acBase.value + shieldAc,
			trace: [
				...acBase.trace,
				{
					source: equippedShield.row.data.name_en,
					layer: 'item',
					op: 'add',
					amount: shieldAc,
					key: SOURCE_KEY.shield,
				},
			],
		};
	}
	return applyEffects('ac', acBase, facts);
}

/** Speed from species base; A3: armor whose `str_min` exceeds the wearer's STR drops it 10 ft (RAW,
 *  both editions), traced as an item-layer contribution so it's explained; then effects layer on top. */
export function deriveSpeed(
	{ scores, facts }: StatInputs,
	speciesRow: LoadedRow | undefined,
	baseSpeed: number,
	equippedArmor: ResolvedItem | undefined,
): Computed {
	const speedBase: Contribution[] = [
		{
			// a species' own name is DATA and passes through; only the "no species yet" fallback is ours
			source: speciesRow ? rowName(speciesRow) : 'Default',
			layer: 'base',
			op: 'add',
			amount: baseSpeed,
			...(speciesRow ? {} : { key: SOURCE_KEY.speciesDefault }),
		},
	];
	const armorStrMin = equippedArmor ? (tagInt(equippedArmor.tags, ITEM_TAG.strMin) ?? 0) : 0;
	if (armorStrMin > 0 && scores.str < armorStrMin)
		speedBase.push({
			source: `${equippedArmor ? rowName(equippedArmor.row) : 'Armor'} (STR ${armorStrMin})`,
			layer: 'item',
			op: 'add',
			amount: -10,
			note: `STR ${scores.str} < ${armorStrMin}`,
			key: SOURCE_KEY.armorTooHeavy,
			noteKey: SOURCE_KEY.armorStrShort,
			// the armor's own name is DATA — the catalog holds the frame around it, never the word
			params: {
				armor: equippedArmor ? rowName(equippedArmor.row) : 'Armor',
				required: armorStrMin,
				score: scores.str,
			},
		});
	return applyEffects('speed', computed(speedBase, { min: 0 }), facts);
}

/** Passive score of every skill (10 + mod ± adv/dis, `passive.<skill>` effects folded). Any ability
 *  check has a passive form (RAW), and the play view pins arbitrary skills as passive senses. */
export function derivePassives(
	skills: Record<SkillId, Computed & { prof: SkillProficiency }>,
	facts: EffectFacts,
): Record<SkillId, Computed> {
	return recordOf(Object.keys(SKILL_ABILITY) as SkillId[], (skill) => {
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
						amount: adv ? 5 : -5,
						key: adv ? SOURCE_KEY.advantage : SOURCE_KEY.disadvantage,
					},
				],
			};
		return applyEffects(`passive.${skill}`, base, facts);
	});
}

/** Damage defenses collected from `damage_sensitivity` facts, deduped per bucket. */
export function deriveDamageSensitivities(facts: EffectFacts): {
	resist: string[];
	immune: string[];
	vulnerable: string[];
} {
	const sensitivities = {
		resist: [] as string[],
		immune: [] as string[],
		vulnerable: [] as string[],
	};
	for (const d of facts.damageSensitivities)
		if (!sensitivities[d.bucket].includes(d.type)) sensitivities[d.bucket].push(d.type);
	return sensitivities;
}
