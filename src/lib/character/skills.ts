/*
 * The 18 SRD skills and their governing abilities — a leaf module (imports only rules/core) so the
 * derive pipeline's sub-modules (target validation, stat phases) can share it without importing
 * derive.ts (which would cycle). Re-exported from derive.ts for existing importers.
 */
import type { Ability } from '../rules/core';

/** Skill → its governing ability (the 18 SRD skills). */
// `as const satisfies` so the KEYS form the `SkillId` union (not widened to `string`) while the
// values are still checked to be `Ability`. This lets the skills map be keyed by `SkillId`, so
// indexing it with a known skill id is sound (no `T | undefined`, no non-null assertions).
export const SKILL_ABILITY = {
	acrobatics: 'dex',
	animal_handling: 'wis',
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
	sleight_of_hand: 'dex',
	stealth: 'dex',
	survival: 'wis'
} as const satisfies Record<string, Ability>;

/** The 18 SRD skill ids. */
export type SkillId = keyof typeof SKILL_ABILITY;
