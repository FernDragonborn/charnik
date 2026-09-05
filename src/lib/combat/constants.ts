/*
 * Static display data + small formatters for the Combat view: the overlay-menu union, panel titles,
 * ability names, the custom-modifier target list, and unit conversions. Split out of the old
 * combat/helpers.ts junk-drawer.
 */
import { ABILITY_IDS, type Ability } from '$lib/rules/core';
import { titleCase } from '$lib/util/format';
import type { Translate } from '$lib/i18n';
import { SKILL_ABILITY, type SkillId } from '$lib/character/derive';
import type { DeathCause } from '$lib/character/schema';

/** The anchored dropdown menus the Combat view can open (overlay.kind). */
export type MenuKind =
	| 'dice'
	| 'temphp'
	| 'levelup'
	| 'addeffect'
	| 'customeffect'
	| 'log'
	| 'pinskills'
	| 'showhide'
	| 'condition'
	| 'upcast'
	| 'restshort'
	| 'manage';

/** Why the character died — the dead banner's subtitle, one key per `play.death.cause`. Catalog
 *  keys rather than phrases: this module has no locale, and both consumers can read one. */
export const DEATH_CAUSE_LABEL: Record<DeathCause, string> = {
	massive_damage: 'combat.deathCause.massive_damage',
	death_saves: 'combat.deathCause.death_saves',
	exhaustion: 'combat.deathCause.exhaustion',
};

/** Re-export of the ONE ability-id list (AUDIT F3) — importers keep using `ABIL`. */
export const ABIL: readonly Ability[] = ABILITY_IDS;
/** The 18 SRD skills (id order) — for the custom-modifier target picker. */
// the 18 skill ids from the ONE owner (AUDIT F4) — snake-case post-E3, so the target values below
// are `skill.animal_handling` (a stale kebab list here silently produced unmatched targets).
const SKILL_IDS = Object.keys(SKILL_ABILITY) as SkillId[];

/** Targets a custom "+N" modifier can point at, grouped for a native <select> with optgroups. The
 *  values are the exact keys the effects engine matches (`ac`, `save.dex`, `skill.stealth`, and the
 *  `saves`/`skills` groups); what each is CALLED comes from `modTargetKey`, since this module has no
 *  locale and the component reading it has one. */
export const MOD_TARGETS: { groupKey: string; targets: string[] }[] = [
	{
		groupKey: 'combat.modTarget.groupCombat',
		targets: ['ac', 'initiative', 'speed'],
	},
	{
		groupKey: 'combat.modTarget.groupSaves',
		targets: ['saves', ...ABILITY_IDS.map((a) => `save.${a}`)],
	},
	{
		groupKey: 'combat.modTarget.groupSkills',
		targets: ['skills', ...SKILL_IDS.map((s) => `skill.${s}`)],
	},
];

/** The catalog key naming ONE modifier target. A save and a skill read the catalogs that already
 *  name them — one word per fact — and the handful left is this control's own little vocabulary. */
export function modTargetKey(target: string): string {
	if (target.startsWith('save.')) return `combat.roll.save.${target.slice(5)}`;
	if (target.startsWith('skill.')) return `skillName.${target.slice(6)}`;
	return `combat.modTarget.${target}`;
}

/** What a custom modifier is called when the player names it nothing: "+1 to AC", "+1 до КЗ". The
 *  label is theirs to edit afterwards, so it is written in the language they wrote it in — unlike a
 *  roll's name, which the log re-reads later and therefore keeps as a key. */
export function modTargetLabel(target: string, translate?: Translate): string {
	const named = translate
		? translate(modTargetKey(target), { default: fallbackTargetLabel(target) })
		: fallbackTargetLabel(target);
	return translate
		? translate('combat.modTarget.to', { values: { target: named } })
		: `to ${named}`;
}

/** The English a caller with no locale reads — a node test, or a label written before i18n starts. */
function fallbackTargetLabel(target: string): string {
	if (target === 'saves') return 'all saves';
	if (target === 'skills') return 'all skills';
	if (target.startsWith('save.')) return `${target.slice(5).toUpperCase()} save`;
	if (target.startsWith('skill.')) return titleCase(target.slice(6));
	return target.toUpperCase();
}

/** Feet → "N m" (metric in parentheses next to imperial). */
export const metres = (ft: number) => `${(ft * 0.3048).toFixed(1).replace(/\.0$/, '')} m`;

/** Pounds → "N kg" (metric in parentheses next to imperial, mirroring `metres` — B7). */
export const kilograms = (lb: number) => `${(lb * 0.4536).toFixed(1).replace(/\.0$/, '')} kg`;
