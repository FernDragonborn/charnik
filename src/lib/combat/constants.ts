/*
 * Static display data + small formatters for the Combat view: the overlay-menu union, panel titles,
 * ability names, the custom-modifier target list, and unit conversions. Split out of the old
 * combat/helpers.ts junk-drawer.
 */
import { ABILITY_IDS, type Ability } from '$lib/rules/core';
import { titleCase } from '$lib/util/format';
import { SKILL_ABILITY, type SkillId } from '$lib/character/derive';

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
	| 'manage';

export const PANEL_TITLE: Record<string, string> = {
	skills: 'Skills',
	attacks: 'Attacks',
	spells: 'Spells',
	actions: 'Actions',
	effects: 'Effects & conditions'
};

/** Re-export of the ONE ability-id list (AUDIT F3) — importers keep using `ABIL`. */
export const ABIL: readonly Ability[] = ABILITY_IDS;
export const ABILITY_NAME: Record<Ability, string> = {
	str: 'Strength',
	dex: 'Dexterity',
	con: 'Constitution',
	int: 'Intelligence',
	wis: 'Wisdom',
	cha: 'Charisma'
};

/** The 18 SRD skills (id order) — for the custom-modifier target picker. */
// the 18 skill ids from the ONE owner (AUDIT F4) — snake-case post-E3, so the target values below
// are `skill.animal_handling` (a stale kebab list here silently produced unmatched targets).
const SKILL_IDS = Object.keys(SKILL_ABILITY) as SkillId[];

/** Targets a custom "+N" modifier can point at, grouped for a native <select> with optgroups.
 *  Values are the exact keys the effects engine matches (`ac`, `save.dex`, `skill.stealth`,
 *  the `saves`/`skills` groups). */
export const MOD_TARGETS: { group: string; opts: { v: string; l: string }[] }[] = [
	{
		group: 'Combat',
		opts: [
			{ v: 'ac', l: 'AC' },
			{ v: 'initiative', l: 'Initiative' },
			{ v: 'speed', l: 'Speed (ft)' }
		]
	},
	{
		group: 'Saves',
		opts: [
			{ v: 'saves', l: 'All saves' },
			...(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((a) => ({
				v: `save.${a}`,
				l: `${a.toUpperCase()} save`
			}))
		]
	},
	{
		group: 'Skills',
		opts: [
			{ v: 'skills', l: 'All skills' },
			...SKILL_IDS.map((s) => ({ v: `skill.${s}`, l: titleCase(s) }))
		]
	}
];

/** Human label for a custom-modifier target key (for the auto effect name). Pure. */
export function modTargetLabel(t: string): string {
	if (t === 'saves') return 'to all saves';
	if (t === 'skills') return 'to all skills';
	if (t.startsWith('save.')) return `to ${t.slice(5).toUpperCase()} save`;
	if (t.startsWith('skill.')) return `to ${titleCase(t.slice(6))}`;
	return `to ${t.toUpperCase()}`;
}

/** Feet → "N m" (metric in parentheses next to imperial). */
export const metres = (ft: number) => `${(ft * 0.3048).toFixed(1).replace(/\.0$/, '')} m`;

/** Pounds → "N kg" (metric in parentheses next to imperial, mirroring `metres` — B7). NOTE: not yet
 *  wired to any UI — carrying-capacity IS computed (sheet.carryingCapacity) but not rendered; when its
 *  tile/toggle lands it MUST use this per the units invariant (lb→kg everywhere). Kept, not deleted.
 *  @public planned — wiring pending (see AUDIT carrying-capacity display gap). */
export const kilograms = (lb: number) => `${(lb * 0.4536).toFixed(1).replace(/\.0$/, '')} kg`;
