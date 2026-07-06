/*
 * Pure, stateless helpers + constants + types for the Combat view. No Svelte runes,
 * no component state — so they can be shared by the state module (state.svelte.ts) and
 * every area component. Split out of the old monolithic combat/+page.svelte.
 */
import type { Ability } from '$lib/rules/core';
import type { Computed } from '$lib/rules/pipeline';
import type { ContentGraph } from '$lib/content/loader';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet, SkillId } from '$lib/character/derive';
import { parseDicePool, parseDiceTerm, type BonusDie, type Rolled } from '$lib/rules/dice';
import { parseEffect, matchesTarget, EFFECT_KIND } from '$lib/effects/index';

// The dice roller and its BonusDie/Rolled types live in the pure rules core; re-exported here so
// existing combat consumers keep importing from one place.
export type { BonusDie, Rolled };

/** A roll-log row: a completed roll (the primary/to-hit) plus what it was for, and — for an attack —
 *  the damage roll that follows it. Rendered as up to 3 lines: the roll, the dropped adv die, damage. */
export type RollLogEntry = Rolled & { label: string; damage?: Rolled };

/** The three action-economy slots a turn tracks. */
export type ActionSlot = 'action' | 'bonus' | 'reaction';

/** A standard combat action row (Dash, Hide, Grapple…). `roll` is present for the ones that make a
 *  check; `hint` shows its live modifier. */
export interface StandardAction {
	id: string;
	name: string;
	hint: string;
	desc: string;
	/** Short right-side tag: "action" / "contest" / "→ roll" / "→ Attacks". */
	marker: string;
	roll?: [string, number];
}

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

/** +N / −N / 0 for a modifier. */
export const signed = (n: number) => (n >= 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

/** `[0, 1, …, n-1]` — for rendering N pips/dots. */
export const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/**
 * Click-to-set for every pip tracker (action economy, spell slots, resources) — ONE model:
 * available pips on the LEFT, spent pips accumulate on the RIGHT. Clicking an available pip spends
 * from it rightward; clicking a spent pip restores from it leftward. Returns the new spent count,
 * always in [0, total]. Pure so it's the single source shared by every tracker and unit-testable.
 */
export function pipClick(currentSpent: number, index: number, total: number): number {
	const remaining = total - currentSpent; // pips 0..remaining-1 are available (left), rest spent
	return index < remaining ? total - index : total - index - 1;
}

/** Scan active effects for what a given roll target (e.g. "save.dex", "skill.stealth", "attack")
 *  picks up: advantage, and signed bonus/penalty dice (Bless +1d4 / Bane −1d4). Pure — the caller
 *  gates it on the effects-auto toggle. `saves`/`skills` group tokens fan out to every save/skill. */
export function rollEffectsFor(
	effects: { effects: string[] }[],
	key: string
): { advantage: boolean; bonusDice: BonusDie[] } {
	const out = { advantage: false, bonusDice: [] as BonusDie[] };
	for (const eff of effects) {
		for (const tok of eff.effects) {
			const p = parseEffect(tok);
			if (!matchesTarget(p.target, key)) continue;
			if (p.kind === EFFECT_KIND.advantage) out.advantage = true;
			else if (p.kind === EFFECT_KIND.flatBonus && p.dice) {
				const die = parseDiceTerm(p.dice);
				if (die) out.bonusDice.push(die);
			}
		}
	}
	return out;
}

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

/** Healing dice from a spell's text ("regains Hit Points equal to 2d4 plus …"). */
export const healDice = (text: string): string => {
	const m = text.match(/(?:equal to|regains?|restores?)[^.]*?(\d+d\d+)/i);
	return m?.[1] ?? '';
};

/** A bounded-vocab effect token → a short readable tag ("flat-bonus:ac+2" → "AC +2",
 *  "flat-bonus:save.dex+1" → "DEX save +1", "flat-bonus:skill.stealth-1" → "Stealth −1"). */
export function effectTag(token: string): string {
	const p = parseEffect(token);
	if (p.kind === EFFECT_KIND.flatBonus && p.target) {
		const t = p.target;
		const delta =
			p.amount !== undefined
				? `${p.amount < 0 ? '−' : '+'}${Math.abs(p.amount)}`
				: `${p.dice?.startsWith('-') ? '−' : '+'}${p.dice?.replace('-', '') ?? ''}`;
		let name = t.toUpperCase();
		if (t === 'saves') name = 'all saves';
		else if (t === 'skills') name = 'all skills';
		else if (t.startsWith('save.')) name = `${t.slice(5).toUpperCase()} save`;
		else if (t.startsWith('skill.')) name = titleCase(t.slice(6));
		else if (t !== 'ac') name = titleCase(t);
		return `${name} ${delta}`;
	}
	return token.replace(/[-:]/g, ' ');
}

/** 1 → "1st", 2 → "2nd", … */
export const ordinal = (n: number) =>
	`${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 || Math.floor(n / 10) === 1 ? 0 : n % 10]}`;

/** The 18 SRD skills (id order) — for the custom-modifier target picker. */
const SKILL_IDS = [
	'acrobatics',
	'animal-handling',
	'arcana',
	'athletics',
	'deception',
	'history',
	'insight',
	'intimidation',
	'investigation',
	'medicine',
	'nature',
	'perception',
	'performance',
	'persuasion',
	'religion',
	'sleight-of-hand',
	'stealth',
	'survival'
] as const;

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
	/** The content ref (effectiveId) — used to set play.concentration when cast. */
	ref: string;
	name: string;
	spe: string;
	res: '' | 'hit' | 'save' | 'auto';
	resLabel: string;
	tm: string;
	ct: '' | 'react' | 'bonus'; // casting time → icon before the level
	dmg: Record<number, number> | null; // parsed damage/healing dice (for casting)
	/** Whether casting this spell requires concentration. */
	conc: boolean;
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

/** Human label for a custom-modifier target key (for the auto effect name). Pure. */
export function modTargetLabel(t: string): string {
	if (t === 'saves') return 'to all saves';
	if (t === 'skills') return 'to all skills';
	if (t.startsWith('save.')) return `to ${t.slice(5).toUpperCase()} save`;
	if (t.startsWith('skill.')) return `to ${titleCase(t.slice(6).replace(/-/g, ' '))}`;
	return `to ${t.toUpperCase()}`;
}

/** Parse a weapon/spell damage string ("1d8 +3 slashing", "1d6 −1 bludgeoning") into its dice pool +
 *  flat mod. Handles the unicode minus `signed()` emits. Pure. */
export function parseDamage(dmg: string): { pool: Record<number, number>; mod: number } {
	const pool = parseDicePool(dmg);
	const m = /([+\-−])\s*(\d+)/.exec(dmg);
	const mod = m ? (m[1] === '+' ? 1 : -1) * Number(m[2]) : 0;
	return { pool, mod };
}

/** Equipped weapons (+ Unarmed Strike) as attack rows, with to-hit/damage from the sheet. Pure. */
export function computeAttacks(
	character: Character,
	sheet: CharacterSheet,
	graph: ContentGraph
): Atk[] {
	const prof = sheet.proficiencyBonus,
		strMod = sheet.abilities.str.mod,
		dexMod = sheet.abilities.dex.mod;
	const out: Atk[] = [];
	for (const inv of character.build.inventory) {
		if (!inv.equipped) continue;
		const row = graph.get(inv.item);
		if (!row || row.data.category !== 'weapon') continue;
		const props = String(row.data.properties ?? '').toLowerCase();
		const ranged = String(row.data.item_type ?? '').includes('ranged');
		const mod = ranged ? dexMod : props.includes('finesse') ? Math.max(strMod, dexMod) : strMod;
		out.push({
			name: String(row.data.name_en),
			toHit: mod + prof,
			dmg: `${row.data.damage ?? ''} ${signed(mod)} ${row.data.damage_type ?? ''}`.trim(),
			meta: [row.data.item_type, props.split(/[,;]/)[0]].filter(Boolean).join(' · ')
		});
	}
	out.push({
		name: 'Unarmed Strike',
		toHit: strMod + prof,
		dmg: `${1 + strMod} bludgeoning`,
		meta: 'melee'
	});
	return out;
}

/** The standard combat actions (Dash, Hide, Grapple…); roll ones reference live skills. Pure. */
export function standardActions(sheet: CharacterSheet | null): StandardAction[] {
	const sk = (k: SkillId) => sheet?.skills[k]?.value ?? 0;
	return [
		{
			id: 'attack',
			name: 'Attack',
			hint: '',
			desc: 'weapon / spell / unarmed',
			marker: '→ Attacks'
		},
		{ id: 'dash', name: 'Dash', hint: '', desc: '+speed this turn', marker: 'action' },
		{
			id: 'disengage',
			name: 'Disengage',
			hint: '',
			desc: 'no opportunity attacks',
			marker: 'action'
		},
		{ id: 'dodge', name: 'Dodge', hint: '', desc: 'attackers have disadv.', marker: 'action' },
		{
			id: 'hide',
			name: 'Hide',
			hint: signed(sk('stealth')),
			desc: 'Stealth',
			marker: '→ roll',
			roll: ['Hide (Stealth)', sk('stealth')]
		},
		{
			id: 'search',
			name: 'Search',
			hint: signed(sk('perception')),
			desc: 'Perception',
			marker: '→ roll',
			roll: ['Search (Perception)', sk('perception')]
		},
		{
			id: 'study',
			name: 'Study',
			hint: signed(sk('arcana')),
			desc: 'recall lore',
			marker: '→ roll',
			roll: ['Study (Arcana)', sk('arcana')]
		},
		{
			id: 'grapple',
			name: 'Grapple',
			hint: signed(sk('athletics')),
			desc: 'Athletics vs target',
			marker: 'contest',
			roll: ['Grapple (Athletics)', sk('athletics')]
		},
		{
			id: 'shove',
			name: 'Shove',
			hint: signed(sk('athletics')),
			desc: 'prone / push 5 ft',
			marker: 'contest',
			roll: ['Shove (Athletics)', sk('athletics')]
		},
		{ id: 'help', name: 'Help', hint: '', desc: 'give an ally advantage', marker: 'action' },
		{ id: 'ready', name: 'Ready', hint: '', desc: 'prepare a trigger', marker: 'action' },
		{ id: 'utilize', name: 'Utilize', hint: '', desc: 'use an object', marker: 'action' }
	];
}

/** Group the character's spells for the spell block (Pinned first, then by level / prepared / school),
 *  attaching the castable slot pool per level. Pure — the VM just wraps it in a `$derived`. */
export function buildSpellGroups(
	character: Character,
	sheet: CharacterSheet | null,
	graph: ContentGraph,
	groupBy: GroupMode,
	pinned: Record<string, boolean>
): SpGroup[] {
	const slotsByLevel = new Map<number, number>();
	for (const p of sheet?.spellcasting.pools ?? [])
		if (!p.forcedUpcast && p.spellLevel) slotsByLevel.set(p.spellLevel, p.max);
	const all = character.build.spells
		.map((sp) => ({
			sp,
			row: spellRow(graph, sp.spell, sp.alwaysPrepared ? 'always' : sp.prepared ? 'on' : '')
		}))
		.filter((x): x is { sp: (typeof character.build.spells)[number]; row: SpRow } => !!x.row);
	const groups: SpGroup[] = [];
	const pins = all.filter((x) => pinned[x.row.id]);
	if (pins.length)
		groups.push({ key: 'pinned', label: '★ Pinned', slots: null, rows: pins.map((x) => x.row) });

	if (groupBy === 'level') {
		const byLevel = new Map<number, SpRow[]>();
		for (const x of all) {
			const lvl = Number(graph.get(x.sp.spell)!.data.level);
			(byLevel.get(lvl) ?? byLevel.set(lvl, []).get(lvl)!).push(x.row);
		}
		for (const lvl of [...byLevel.keys()].sort((a, b) => a - b)) {
			groups.push({
				key: String(lvl),
				label: lvl === 0 ? 'Cantrips' : ordinal(lvl),
				slots:
					lvl === 0
						? null
						: {
								full: slotsByLevel.get(lvl) ?? 0,
								spent: Number(character.play.spellSlotsSpent[String(lvl)] ?? 0)
							},
				rows: byLevel.get(lvl)!
			});
		}
	} else if (groupBy === 'prepared') {
		const prep = all.filter((x) => x.row.prep).map((x) => x.row);
		const rest = all.filter((x) => !x.row.prep).map((x) => x.row);
		if (prep.length) groups.push({ key: 'prep', label: 'Prepared', slots: null, rows: prep });
		if (rest.length) groups.push({ key: 'unprep', label: 'Not prepared', slots: null, rows: rest });
	} else {
		const bySchool = new Map<string, SpRow[]>();
		for (const x of all) {
			const sch = String(graph.get(x.sp.spell)!.data.school || 'Other');
			(bySchool.get(sch) ?? bySchool.set(sch, []).get(sch)!).push(x.row);
		}
		for (const sch of [...bySchool.keys()].sort())
			groups.push({
				key: 'sch:' + sch,
				label: titleCase(sch),
				slots: null,
				rows: bySchool.get(sch)!
			});
	}
	return groups;
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
		ref,
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
		dmg: dmg ? parseDicePool(dmg) : null,
		conc: String(row.data.concentration) === 'true',
		prep
	};
}
