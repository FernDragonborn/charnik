/*
 * What a reader is shown of a computed value's trace — the parts they add up, which are not always
 * the parts the engine folded. Beside effects-view.ts, which says each part; this decides which
 * parts there are.
 */
import { foldRank, type Computed, type Contribution } from '$lib/rules/pipeline';

/** Ops that read as a comparison say something even at 0 (`= 0`); a plain addend of 0 says nothing. */
const COMPARES: ReadonlySet<Contribution['op']> = new Set(['set', 'base', 'floor', 'cap']);

/** The parts of a value a reader is shown, in the order they fold — a base before what adds to it.
 *  Three things are not parts of the number to a reader, and the trace keeps all three: a base a
 *  `base` replaced (its note explains it), an addend of 0 (heavy armour's ignored DEX is the armour's
 *  rule), and the split of ONE carried item across the core and its effects — Plate +3's own 18 and
 *  its +3 read as one part named for the plate, its pieces in the part's note. */
export function shownTrace(c: Computed): Contribution[] {
	const ordered = c.trace
		.filter((t) => !t.superseded && (t.amount !== 0 || COMPARES.has(t.op)))
		.map((t, index) => ({ t, index }))
		.sort((a, b) => foldRank(a.t) - foldRank(b.t) || a.index - b.index)
		.map(({ t }) => t);
	// one entry per part shown; an item's entry collects every addend it brought
	const parts: Contribution[][] = [];
	for (const t of ordered) {
		const item =
			t.origin !== undefined && t.op === 'add'
				? parts.find(([first]) => first?.op === 'add' && first.origin === t.origin)
				: undefined;
		if (item) item.push(t);
		else parts.push([t]);
	}
	return parts.flatMap((group) => (group.length > 1 ? [itemPart(group)] : group));
}

/** One carried item's addends as one part: named by the addend that carries the item's own name (an
 *  effect's source is its row's — or its instance's, "Plate +3") rather than the core's generic
 *  "Armor", and saying in its note what it was made of. */
function itemPart(group: Contribution[]): Contribution {
	const [first] = group;
	const named = group.find((t) => t.key === undefined) ?? first;
	return {
		source: named?.source ?? '',
		layer: first?.layer ?? 'item',
		op: 'add',
		amount: group.reduce((sum, t) => sum + t.amount, 0),
		note: group.map((t) => t.amount).join(' + '),
		...(first?.origin !== undefined ? { origin: first.origin } : {}),
	};
}
