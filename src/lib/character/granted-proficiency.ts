/*
 * What an EFFECT granted, as the sheet reads it: the proficiency ladder, the rung a feature put a
 * check on, and the equipment a feature made you proficient with.
 *
 * A module of its own because it is one question asked from both ends — `derive-stats` folds the
 * rungs into skills and ability checks, the builder reads the same ladder to show what it may not
 * un-pick — and because the answer is NOT just a level: it carries the granting feature's own name
 * and how its `partial` rounds, which is what keeps one feature's arithmetic out of another's trace.
 */
import type { EffectFacts } from '../effects/apply';
import type { Ability, PartialProficiency } from '../rules/core';
import { ABILITIES } from './schema';
import { SKILL_ABILITY, type SkillId } from './skills';

/** Skill proficiency level (a rung, not two booleans): none → partial (Jack of All Trades) →
 *  proficient → expertise (×2). `partial` rather than `half`: a rung is written BEFORE its target in
 *  a token, so `half:skills` reads as "half the skills", and "half" reads as a reduction when this
 *  rung is a GAIN — a lesser proficiency, not a cut-down one. */
export type SkillProficiency = 'none' | 'partial' | 'proficient' | 'expertise';

/** The `check.<ability>` target namespace — a grant aimed at every check one ability makes. */
export const CHECK_PREFIX = 'check.';

/** One effect-granted rung, with what the sheet needs to SAY it: the feature's own name for the
 *  trace, and how its `partial` rounds. A bare `SkillProficiency` lost both, so every partial rung
 *  was spent as Jack of All Trades' — the wrong number under another feature's name. */
export interface GrantedProficiency {
	level: SkillProficiency;
	rounding?: 'up';
	source: string;
}
/** One `grant_proficiency` fact, as this module reads it. */
type ProficiencyGrant = EffectFacts['proficiencies'][number];
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
export const maxProf = (a: SkillProficiency, b: SkillProficiency): SkillProficiency =>
	PROF_ORDER[a] >= PROF_ORDER[b] ? a : b;

/** The prefixes that make a `grant_proficiency` target EQUIPMENT rather than a save or a skill —
 *  `armor.heavy` (Life Domain), `weapon.martial`, `weapon.warhammer` (Dwarven Combat Training). */
const EQUIPMENT_PREFIX = { armor: 'armor.', weapon: 'weapon.' } as const;
/** …and the one that makes it a TOOL (`tool.thieves_tools`). Its own namespace rather than a third
 *  equipment prefix: equipment proficiency answers "may I use this without penalty", a tool's
 *  answers "does my proficiency bonus ride this check", and only one of them is a roll. */
export const TOOL_PREFIX = 'tool.';

/** The group targets that mean every save, or every skill, at once. */
const ALL_SAVES = 'saves';
const ALL_SKILLS = 'skills';

/** Effect-granted proficiencies split into saves (proficient-or-not) + skills (by ladder level).
 *  `grant_proficiency:[expertise:]<target>` — the parser already stripped any `skill.` prefix; a
 *  save target is `con` / `save.con`; expertise on a save just means proficient (doesn't apply).
 *  Equipment targets are NOT skills and are picked off first — `grantedEquipmentProfs` reads them. */
export function gatherGrantedProficiencies(facts: EffectFacts): {
	grantedSaves: Set<Ability>;
	grantedSkills: Map<string, GrantedProficiency>;
} {
	const grantedSaves = new Set<Ability>();
	const grantedSkills = new Map<string, GrantedProficiency>();
	for (const p of facts.proficiencies) {
		if (isEquipmentTarget(p.target) || p.target.startsWith(TOOL_PREFIX)) continue;
		// "proficiency in ALL saving throws" (Diamond Soul) is one statement in the rules, so it is one
		// token here rather than six — spelling out the six would be data the source does not have.
		if (p.target === ALL_SAVES) {
			for (const a of ABILITIES) grantedSaves.add(a);
			continue;
		}
		// the rungs combine by max (`betterGrant`), so a skill already proficient keeps proficiency —
		// RAW's "that doesn't already include your proficiency bonus", without a second rule for it
		const targets = grantTargets(p.target);
		for (const tgt of targets) {
			if ((ABILITIES as readonly string[]).includes(tgt)) grantedSaves.add(tgt as Ability);
			else grantedSkills.set(tgt, betterGrant(grantedSkills.get(tgt), p));
		}
	}
	return { grantedSaves, grantedSkills };
}

/**
 * Which check keys one grant target names.
 *
 * `skills` is the whole ladder-bearing set (Jack of All Trades' one token rather than eighteen), and
 * `check.<ability>` is every check that ability makes — 2014 Remarkable Athlete's "any Strength,
 * Dexterity, or Constitution check". That is the BARE check plus every skill built on it, because in
 * the rules those are one sentence. Anything else names one key.
 */
function grantTargets(target: string): string[] {
	if (target === ALL_SKILLS) return Object.keys(SKILL_ABILITY);
	const ability = target.startsWith(CHECK_PREFIX) ? target.slice(CHECK_PREFIX.length) : undefined;
	if (ability !== undefined && (ABILITIES as readonly string[]).includes(ability))
		return [
			target,
			...Object.keys(SKILL_ABILITY).filter((s) => SKILL_ABILITY[s as SkillId] === ability),
		];
	return [target.replace(/^save\./, '')];
}

/** The `partial` argument `skillCheck` takes, when the rung in force IS partial and a grant said so.
 *  Spread into the call, so the property is absent rather than `undefined` under
 *  `exactOptionalPropertyTypes`. */
export function partialFrom(
	level: SkillProficiency,
	granted: GrantedProficiency | undefined,
): { partial?: PartialProficiency } {
	if (level !== 'partial' || granted?.level !== 'partial') return {};
	return { partial: { rounding: granted.rounding ?? 'down', source: granted.source } };
}

/** The better of two grants on one key: the higher RUNG, and between two `partial`s the one that
 *  rounds up — which is the only way they can differ and is never a loss. */
function betterGrant(
	held: GrantedProficiency | undefined,
	p: ProficiencyGrant,
): GrantedProficiency {
	const next: GrantedProficiency = {
		level: p.level,
		...(p.rounding ? { rounding: p.rounding } : {}),
		source: p.source,
	};
	if (!held) return next;
	if (PROF_ORDER[next.level] > PROF_ORDER[held.level]) return next;
	if (PROF_ORDER[next.level] < PROF_ORDER[held.level]) return held;
	return held.rounding === 'up' ? held : next;
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
