/*
 * What a tap on an ability, a save or a skill rolls: what the roll is called, the number it adds,
 * and the effects it picks up.
 *
 * One definition, because the same check is asked for from more than one place — the sheet's own
 * panels, and a roll the GM asks for across the table — and two sites building it by hand is how
 * one of them rolls under another name or with no effects at all.
 */
import type { CharacterSheet } from '#lib/character/derive.ts';
import { SKILL_IDS, type SkillId } from '#lib/character/skills.ts';
import { ABILITY_IDS, type Ability } from '#lib/rules/core.ts';
import { titleCase } from '#lib/util/format.ts';
import { skillRollTarget, type RollName } from './roll';

export interface SheetRollSpec {
	name: RollName;
	/** The folded bonus the sheet shows for it. */
	mod: number;
	/** Which effects the roll picks up: an effect key, and the scopes that narrow it. */
	target: string | { key: string; scopes: Set<string> };
}

export const abilityCheckRoll = (ability: Ability, sheet: CharacterSheet): SheetRollSpec => ({
	name: { text: `${ability.toUpperCase()} check`, key: `combat.roll.check.${ability}` },
	mod: sheet.abilities[ability].check.value,
	target: `check.${ability}`,
});

export const savingThrowRoll = (ability: Ability, sheet: CharacterSheet): SheetRollSpec => ({
	name: { text: `${ability.toUpperCase()} save`, key: `combat.roll.save.${ability}` },
	mod: sheet.abilities[ability].save.value,
	target: `save.${ability}`,
});

export const skillRoll = (skill: SkillId, sheet: CharacterSheet): SheetRollSpec => ({
	name: { text: titleCase(skill), key: `skillName.${skill}` },
	mod: sheet.skills[skill].value,
	target: skillRollTarget(skill, sheet),
});

/** An id that came from outside the sheet, as the ability it names — or undefined. */
export const abilityOf = (id: string): Ability | undefined =>
	ABILITY_IDS.find((ability) => ability === id);

/** An id that came from outside the sheet, as the skill it names — or undefined. */
export const skillOf = (id: string): SkillId | undefined => SKILL_IDS.find((skill) => skill === id);
