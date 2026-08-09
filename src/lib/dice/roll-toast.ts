/*
 * The roll-toast view model + the ONE way to toast a completed roll. Every roll site (combat's
 * pushRoll, the RollButton, the no-tray fallback) went through its own `toast(string)` template, so
 * the same roll rendered three different ways. They now all call `toastRoll`, which mounts the
 * RollToast component with the model built here.
 *
 * The model is the "toast grows with the roll" shape (design 5A): a fixed-width total column on the
 * right whatever the height, one row per thing rolled, and uppercase row labels only once there IS
 * more than one row. Pure — the component just renders it.
 */
import { toast } from 'svelte-sonner';
import { parseRollExpr, type DieChip, type Rolled } from '$lib/rules/dice';
import { damageTotal, type RollLogEntry, type TypedRoll } from '$lib/combat/roll';
import RollToast from '$lib/components/RollToast.svelte';

/** One rolled line: its dice, the flat mod folded into it, and what it came to. */
export interface RollToastRow {
	/** Uppercase row label ("to hit", "fire") — rendered only when the toast has 2+ rows. */
	label?: string;
	chips: DieChip[];
	/** The adv/disadv d20 that lost — shown struck through next to the kept one. */
	dropped?: number;
	mod: number;
	subtotal: number;
}

/** A short state marker in the toast's title row (nat 20 / advantage). Tone picks the accent. */
interface RollToastTag {
	text: string;
	tone: 'good' | 'gold' | 'danger';
}

export interface RollToastModel {
	label: string;
	rows: RollToastRow[];
	/** The big number in the right column: the damage sum for an attack, else the roll total. */
	total: number;
	/** Caption under the big number — set when it is NOT what the label rolled (an attack's damage). */
	caption?: string;
	tag?: RollToastTag;
	note?: string;
}

/** "nat 20"/"nat 1" beat adv/disadv: a natural is about the outcome, adv only about how it was got.
 *  Deliberately NOT called a crit — the same d20 is a crit on an attack and just a 20 on a check, and
 *  the toast doesn't know which (play-tracker surfaces, never rules on it). */
function tagFor(r: Rolled): RollToastTag | undefined {
	if (r.natural === 20) return { text: 'nat 20', tone: 'gold' };
	if (r.natural === 1) return { text: 'nat 1', tone: 'danger' };
	if (!r.advantageRoll) return undefined;
	return r.advantageRoll.kept >= r.advantageRoll.dropped
		? { text: 'advantage', tone: 'good' }
		: { text: 'disadvantage', tone: 'danger' };
}

/** Damage rows for an attack — one per damage type, labelled with the type. */
const damageRows = (damage: TypedRoll[]): RollToastRow[] =>
	damage.map((part) => {
		const { chips, mod } = parseRollExpr(part.expr);
		return { label: part.type || 'damage', chips, mod, subtotal: part.total };
	});

/** Build the toast model from a completed roll (the same shape the roll log stores). */
export function rollToastModel(entry: RollLogEntry): RollToastModel {
	const { chips, mod } = parseRollExpr(entry.expr);
	const adv = entry.advantageRoll;
	// the kept adv/disadv d20 never made it into `expr` (the roller surfaces it separately) — put it
	// back at the front so the row reads left-to-right as the dice were rolled
	const primary: RollToastRow = {
		chips: adv ? [{ sides: 20, value: adv.kept, sign: 1, detail: `${adv.kept}` }, ...chips] : chips,
		...(adv ? { dropped: adv.dropped } : {}),
		mod,
		subtotal: entry.total
	};
	const damage = entry.damage ?? [];
	if (damage.length) primary.label = 'to hit';
	const tag = tagFor(entry);
	return {
		label: entry.label,
		rows: [primary, ...damageRows(damage)],
		total: damage.length ? damageTotal(damage) : entry.total,
		...(damage.length ? { caption: 'damage' } : {}),
		...(tag ? { tag } : {}),
		...(entry.note ? { note: entry.note } : {})
	};
}

/** Toast a completed roll. The one roll-toast call site — pass the roll, not a formatted string. */
export function toastRoll(entry: RollLogEntry): void {
	toast.custom(RollToast, { componentProps: { model: rollToastModel(entry) } });
}
