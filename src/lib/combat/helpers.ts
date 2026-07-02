/*
 * Pure, stateless helpers + constants + types for the Combat view. No Svelte runes,
 * no component state — so they can be shared by the state module (state.svelte.ts) and
 * every area component. Split out of the old monolithic combat/+page.svelte.
 */
import type { Ability } from '$lib/rules/core';
import type { Computed } from '$lib/rules/pipeline';
import type { ContentGraph } from '$lib/content/loader';

/** +N / −N / 0 for a modifier. */
export const signed = (n: number) => (n >= 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

/** Feet → "N m" (metric in parentheses next to imperial). */
export const metres = (ft: number) => `${(ft * 0.3048).toFixed(1).replace(/\.0$/, '')} m`;

/** Provenance trace of a Computed → a human-readable "why" string for tooltips. */
export function why(c: Computed): string {
	const parts = c.trace
		.filter((t) => t.amount !== 0 || t.op === 'set')
		.map(
			(t) =>
				`${t.source} ${t.op === 'set' ? '= ' : ''}${signed(t.amount)}${t.note ? ` (${t.note})` : ''}`
		);
	return (parts.join(', ') || '—') + (c.notes?.length ? ' · ' + c.notes.join(' · ') : '');
}

/** "sleight-of-hand" → "Sleight Of Hand". */
export const titleCase = (s: string) =>
	s.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

/** Extract a dice pool ({sides: count}) from any string containing NdM tokens. */
export const parseDice = (s: string): Record<number, number> => {
	const out: Record<number, number> = {};
	for (const m of s.matchAll(/(\d+)d(\d+)/gi))
		out[Number(m[2])] = (out[Number(m[2])] ?? 0) + Number(m[1]);
	return out;
};

/** Healing dice from a spell's text ("regains Hit Points equal to 2d4 plus …"). */
export const healDice = (text: string): string => {
	const m = text.match(/(?:equal to|regains?|restores?)[^.]*?(\d+d\d+)/i);
	return m ? m[1] : '';
};

/** A bounded-vocab effect token → a short readable tag ("flat-bonus:ac+2" → "AC +2"). */
export function effectTag(token: string): string {
	const m = token.match(/^flat-bonus:(\w+)([+-].+)$/);
	if (m) return `${m[1] === 'ac' ? 'AC' : m[1]} ${m[2]}`;
	return token.replace(/[-:]/g, ' ');
}

/** 1 → "1st", 2 → "2nd", … */
export const ordinal = (n: number) =>
	`${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 || Math.floor(n / 10) === 1 ? 0 : n % 10]}`;

/** A normal tap rolls instantly; Alt/Ctrl/Cmd-click opens the prefilled roll tray. */
export const wantsTray = (e: Event) => {
	const m = e as MouseEvent;
	return m.altKey || m.ctrlKey || m.metaKey;
};

export const PANEL_TITLE: Record<string, string> = {
	skills: 'Skills',
	attacks: 'Attacks',
	spells: 'Spells',
	actions: 'Actions',
	effects: 'Effects & conditions'
};
export const ABIL: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const ABILITY_NAME: Record<Ability, string> = {
	str: 'Strength',
	dex: 'Dexterity',
	con: 'Constitution',
	int: 'Intelligence',
	wis: 'Wisdom',
	cha: 'Charisma'
};
export const DICE = [4, 6, 8, 10, 12, 20, 100];
export const GROUP_MODES = ['level', 'prepared', 'school'] as const;
export type GroupMode = (typeof GROUP_MODES)[number];
export const EFFECT_PRESETS = [
	{ label: 'Bless', tokens: ['flat-bonus:saves+1d4'] },
	{ label: 'Bane', tokens: ['flat-bonus:saves-1d4'] },
	{ label: 'Shield of Faith', tokens: ['flat-bonus:ac+2'] },
	{ label: 'Half cover', tokens: ['flat-bonus:ac+2'] },
	{ label: 'Three-quarters cover', tokens: ['flat-bonus:ac+5'] }
];

/** A weapon/unarmed attack row. */
export interface Atk {
	name: string;
	toHit: number;
	dmg: string;
	meta: string;
}

/** A spell row in the spell block. */
export interface SpRow {
	id: string;
	name: string;
	spe: string;
	res: '' | 'hit' | 'save' | 'auto';
	resLabel: string;
	tm: string;
	ct: '' | 'react' | 'bonus'; // casting time → icon before the level
	dmg: Record<number, number> | null; // parsed damage/healing dice (for casting)
	prep: '' | 'on' | 'always';
}

/** A group of spells (Pinned / by level / by prepared / by school). */
export interface SpGroup {
	key: string;
	label: string;
	slots: { full: number; spent: number } | null;
	rows: SpRow[];
}

/** Casting-time → the icon shown before the level (↩ reaction, ⚡ bonus). */
export const castingIcon = (ct: string): SpRow['ct'] =>
	/bonus/i.test(ct) ? 'bonus' : /reaction/i.test(ct) ? 'react' : '';

/** Short effect summary for a non-damage spell (curated, falls back to "utility"). */
export function effectHint(d: Record<string, unknown>): string {
	const range = String(d.range ?? '');
	if (/self/i.test(range) && /step|door|teleport/i.test(String(d.name_en))) return 'teleport';
	if (/counter/i.test(String(d.name_en))) return 'negate spell';
	if (
		/mage hand|prestidig|light|message|minor illusion|mage armor|fly|invis|mirror/i.test(
			String(d.name_en)
		)
	)
		return (
			{
				'mage hand': 'utility',
				'mage armor': 'set AC 13',
				fly: 'fly 60 ft',
				'mirror image': '3 duplicates'
			}[String(d.name_en).toLowerCase()] ?? 'utility'
		);
	return 'utility';
}

/** Build a spell row from the content graph (or null if the ref is missing). */
export function spellRow(graph: ContentGraph, ref: string, prep: SpRow['prep']): SpRow | null {
	const row = graph.get(ref);
	if (!row) return null;
	const lvl = Number(row.data.level);
	const res = String(row.data.resolution ?? 'none');
	// dice for casting: the damage field, or (for auto/healing spells) the "regains …
	// equal to NdM" dice parsed out of the description
	const dmg =
		String(row.data.damage ?? '') ||
		(res === 'auto' ? healDice(String(row.data.text_en ?? '')) : '');
	return {
		id: String(row.data.id),
		name: String(row.data.name_en),
		spe: dmg || effectHint(row.data),
		res: res === 'attack' ? 'hit' : res === 'save' ? 'save' : res === 'auto' ? 'auto' : '',
		resLabel:
			res === 'attack'
				? 'attack roll'
				: res === 'save'
					? `${row.data.save_ability} save`
					: res === 'auto'
						? 'auto'
						: '',
		tm: lvl === 0 ? 'cantrip' : ordinal(lvl),
		ct: castingIcon(String(row.data.casting_time ?? '')),
		dmg: dmg ? parseDice(dmg) : null,
		prep
	};
}
