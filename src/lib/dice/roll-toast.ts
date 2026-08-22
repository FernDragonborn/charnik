/*
 * The roll-toast view model + the ONE way to toast a completed roll. Every roll site (combat's
 * pushRoll, the RollButton, the no-tray fallback) went through its own `toast(string)` template, so
 * the same roll rendered three different ways. They now all call `toastRoll`, which mounts the
 * RollToast component with the model built here.
 *
 * The shape is the final toast design (design-preview/toast-update): the card shrinks to its
 * content, one grid row per ATTACK, and the damage half of the row only exists when something was
 * damaged. A plain check is that same row minus the damage half. Pure — the component just renders.
 */
import { toast } from 'svelte-sonner';
import { DIE_ROLE, type RolledDie, type Rolled } from '$lib/rules/dice';
import { damageTotal, type RollLogEntry, type TypedRoll } from '$lib/combat/roll';
import RollToast from '$lib/components/RollToast.svelte';

/** One damage type inside an attack: its glyph key, the dice it rolled (a crit's doubled dice ride
 *  ONE pill, divided), the flat mod folded in, and what the part came to. */
export interface RollToastDamage {
	/** Damage-type key ("fire") → glyph. "" when the content row carried no type. */
	type: string;
	chips: RolledDie[];
	mod: number;
	total: number;
}

/** One attack line: the d20 that decided it plus the damage it rolled. A plain check/save is the
 *  same line with an empty `damage` — the toast then simply has no damage half. */
export interface RollToastAttack {
	chips: RolledDie[];
	/** The adv/disadv d20 that lost — shown struck through next to the kept one. */
	dropped?: number;
	/** Was the pair rolled at advantage (1) or disadvantage (−1)? Frames the two d20 green or red —
	 *  the one thing about a roll you can't read off the numbers (two 12s look identical either way). */
	advantageMode?: 1 | -1;
	mod: number;
	/** What the to-hit (or, with no damage, the roll itself) came to. */
	subtotal: number;
	/** The natural face of the d20. 20 tints the line gold, 1 calls it a miss. Deliberately NOT
	 *  called a crit: the same 20 is a crit on an attack and just a 20 on a check, and the toast
	 *  doesn't know which (play-tracker surfaces, never rules). */
	natural?: number;
	damage: RollToastDamage[];
	/** This line's damage sum — shown per line only when several attacks share the toast. */
	damageTotal: number;
}

/** How a roll is presented. An open named enum, not a boolean: the two cases differ in CONTENT as
 *  well as shape — `strip` folds a pool into a count, shows a damage part's total instead of its
 *  dice, summarises a volley and moves the note to a tooltip — so "true" would be carrying policy
 *  under a name that only describes layout, and a third presentation would have nowhere to go
 *  (AI-CONVENTIONS §1.5). Compare via the named members, never bare strings. */
export const ROLL_LAYOUT = {
	/** The full card: every die, captions, a row per attack. The toast, the log and the dice tray. */
	card: 'card',
	/** One line of an already-crowded screen: bounded content, no captions. The Playbar. */
	strip: 'strip',
} as const;
export type RollLayout = (typeof ROLL_LAYOUT)[keyof typeof ROLL_LAYOUT];

export interface RollToastModel {
	label: string;
	attacks: RollToastAttack[];
	/** True once anything was damaged: the "to hit"/"damage" captions, the damage column and the
	 *  per-type footer all hang off this. */
	damaging: boolean;
	/** Damage summed per type across the attacks — the footer of a multi-attack toast. */
	byType: { type: string; total: number }[];
	/** The big number on the right: total damage when there is any, else the roll total. */
	total: number;
	note?: string;
}

/** A nat 1 is the ONE miss the app can call without knowing the target's AC — so its damage is shown
 *  struck and left out of every total. Anything else is the DM's call, not the toast's. */
const landed = (a: RollToastAttack): boolean => a.natural !== 1;

/** A damage part → its toast row: the type keeps its glyph, the dice come straight off the roll. */
const damagePart = (part: TypedRoll): RollToastDamage => ({
	type: part.type,
	chips: part.dice,
	mod: part.mod,
	total: part.total,
});

/** One completed roll (+ the damage that followed it) → one attack line. */
function attackLine(roll: Rolled, damage: TypedRoll[]): RollToastAttack {
	const chips = roll.dice;
	const mod = roll.mod;
	const adv = roll.advantageRoll;
	// the kept adv/disadv d20 never made it into `expr` (the roller surfaces it separately) — put it
	// back at the front so the line reads left-to-right as the dice were rolled
	// `mode` is absent on rolls logged before it was recorded — fall back to what the pair implies,
	// which is right except on a tie (where nothing could tell them apart anyway)
	const mode = adv ? (adv.mode ?? (adv.kept >= adv.dropped ? 1 : -1)) : undefined;
	return {
		chips: adv
			? [
					{
						sides: 20,
						value: adv.kept,
						face: roll.natural ?? adv.kept,
						sign: 1,
						detail: `${adv.kept}`,
						role: DIE_ROLE.pool,
					},
					...chips,
				]
			: chips,
		...(adv ? { dropped: adv.dropped } : {}),
		...(mode ? { advantageMode: mode } : {}),
		mod,
		subtotal: roll.total,
		...(roll.natural !== undefined ? { natural: roll.natural } : {}),
		damage: damage.map(damagePart),
		damageTotal: damageTotal(damage),
	};
}

/** Damage summed per type across the landed attacks, in first-seen order (the footer's reading
 *  order should follow the lines above it, not an alphabet). */
function sumByType(attacks: RollToastAttack[]): { type: string; total: number }[] {
	const totals = new Map<string, number>();
	for (const a of attacks.filter(landed))
		for (const d of a.damage) totals.set(d.type, (totals.get(d.type) ?? 0) + d.total);
	return [...totals].map(([type, total]) => ({ type, total }));
}

/**
 * Build the toast model from completed rolls (the same shape the roll log stores). Pass an ARRAY for
 * several attacks resolved as one action (Extra Attack / Flurry of Blows): they share one card, one
 * line each, and a per-type footer under them. The label comes from the first roll.
 */
export function rollToastModel(rolled: RollLogEntry | RollLogEntry[]): RollToastModel {
	const entries = Array.isArray(rolled) ? rolled : [rolled];
	const attacks = entries.map((e) => attackLine(e, e.damage ?? []));
	const damaging = attacks.some((a) => a.damage.length > 0);
	const note = entries.find((e) => e.note)?.note;
	return {
		label: entries[0]?.label ?? '',
		attacks,
		damaging,
		byType: attacks.length > 1 ? sumByType(attacks) : [],
		total: damaging
			? attacks.filter(landed).reduce((n, a) => n + a.damageTotal, 0)
			: (attacks[0]?.subtotal ?? 0),
		...(note ? { note } : {}),
	};
}

/** Toast a completed roll. The one roll-toast call site — pass the roll, not a formatted string.
 *
 *  The toast ANNOUNCES; it never controls (UX-3). A toast is a bad host for an edit: it expires
 *  mid-decision, older ones get buried by the stack, and making its pills interactive would collide
 *  with click-anywhere-to-dismiss. So the live controls (retroactive advantage, a damage reroll) live
 *  on the always-visible Playbar for the last roll and in the log for any roll, forever — the same
 *  `RollRow` in each, so they arrive in both for free. With no decision to hold open, a roll toast has
 *  no reason to outlive the normal duration either. */
export function toastRoll(rolled: RollLogEntry | RollLogEntry[]): void {
	toast.custom(RollToast, { componentProps: { model: rollToastModel(rolled) } });
}
