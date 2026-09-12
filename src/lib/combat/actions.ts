/*
 * The standard combat actions list (Dash, Hide, Grapple…), system-aware (2014/2024). Pure.
 * Split out of the old combat/helpers.ts junk-drawer.
 */
import { signed } from '$lib/util/format';
import type { System } from '$lib/rules/pipeline';
import type { CharacterSheet, SkillId } from '$lib/character/derive';

/** A standard combat action row (Dash, Hide, Grapple…). `roll` is present for the ones that make a
 *  check; `hint` shows its live modifier.
 *
 *  Everything a reader SEES is a catalog key, not a word: this is a closed rules vocabulary the UI
 *  names, and a check's roll name travels as a key for the same reason a tapped stat's does — the
 *  log keeps the line verbatim. */
export interface StandardAction {
	id: string;
	nameKey: string;
	hint: string;
	descKey: string;
	/** Short right-side tag: action / contest / → roll / → Attacks. */
	markerKey: string;
	/** `[roll-name key, modifier]` for the actions that make a check. */
	roll?: [string, number];
	/** The skill that check IS, so the roll picks up the same effects the skills panel's own row does
	 *  (advantage, Bless dice, a reroll floor). Present exactly when `roll` is. */
	skill?: SkillId;
}

const MARKER = {
	action: 'combat.action.markerAction',
	contest: 'combat.action.markerContest',
	roll: 'combat.action.markerRoll',
	attacks: 'combat.action.markerAttacks',
} as const;

/** The rows themselves: what an action IS. Its name, description and roll-name keys are derived from
 *  the id (`combat.action.<id>`, `…Desc`, `…Roll`), so an action is spelled in exactly one place —
 *  the catalog — and a new one is a line here plus its entries there. */
const ROWS: {
	id: string;
	marker: keyof typeof MARKER;
	/** The skill its check rolls, when it makes one. */
	skill?: SkillId;
	/** Only in this system — Study is a 2024 action. */
	system?: System;
	/** When the two editions call it different things. */
	nameKey?: string;
}[] = [
	{ id: 'attack', marker: 'attacks' },
	{ id: 'dash', marker: 'action' },
	{ id: 'disengage', marker: 'action' },
	{ id: 'dodge', marker: 'action' },
	{ id: 'hide', marker: 'roll', skill: 'stealth' },
	{ id: 'search', marker: 'roll', skill: 'perception' },
	{ id: 'study', marker: 'roll', skill: 'arcana', system: '5.5e' },
	{ id: 'grapple', marker: 'contest', skill: 'athletics' },
	{ id: 'shove', marker: 'contest', skill: 'athletics' },
	{ id: 'help', marker: 'action' },
	{ id: 'ready', marker: 'action' },
	{ id: 'utilize', marker: 'action' },
];

/** The standard combat actions (Dash, Hide, Grapple…); roll ones reference live skills. Pure. */
export function standardActions(sheet: CharacterSheet | null, system: System): StandardAction[] {
	const sk = (k: SkillId) => sheet?.skills[k]?.value ?? 0;
	// 2024 renamed 2014's "Use an Object" to "Utilize" — the one row whose name is edition-dependent
	const nameOf = (id: string) =>
		id === 'utilize' && system === '5e' ? 'combat.action.useAnObject' : `combat.action.${id}`;
	return ROWS.filter((r) => !r.system || r.system === system).map((r) => ({
		id: r.id,
		nameKey: r.nameKey ?? nameOf(r.id),
		hint: r.skill ? signed(sk(r.skill)) : '',
		descKey: `combat.action.${r.id}Desc`,
		markerKey: MARKER[r.marker],
		...(r.skill
			? { roll: [`combat.action.${r.id}Roll`, sk(r.skill)] as [string, number], skill: r.skill }
			: {}),
	}));
}
