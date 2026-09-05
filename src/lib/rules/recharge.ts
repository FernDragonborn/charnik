/*
 * How a resource pool comes back: at WHICH boundary, and HOW MUCH.
 *
 * Two axes, because one word could not hold both. The rest policies (`short`, `long`) say when and
 * imply "all of it"; a magic item says "regains 1d6+1 expended charges daily at dawn", which is a
 * different boundary AND a partial amount. Bending that into a rest enum would have made `dawn` a
 * kind of rest, and the amount unsayable.
 *
 * The one-word policies stay exactly as they are ON DISK — `grant_resource:ki:2:short` still means
 * what it always did — and become sugar for a `{trigger, amount}` here. `short_one` is the pattern
 * that proves the model: it was a THIRD rest policy invented to say "one use back", and it is now
 * `short` + an amount of 1, said in the general grammar.
 */
/**
 * The boundaries a pool can come back at.
 *
 * `consumable` and `other` are not boundaries but the two ways of never coming back on their own —
 * used up for good (a potion's charge) versus restored by hand (a GM's call). They are members
 * rather than a `none` because the sheet says which one it is, and a chip reading "consumable" tells
 * a player something "special" does not.
 */
export const RECHARGE_TRIGGERS = ['short', 'long', 'dawn', 'dusk', 'consumable', 'other'] as const;
export type RechargeTrigger = (typeof RECHARGE_TRIGGERS)[number];

/** The whole pool, said as a cell. Named because a bare `'all'` in a comparison is exactly the
 *  literal that goes wrong when someone types `full`. */
export const RECHARGE_ALL = 'all';

/** How much comes back at that boundary: {@link RECHARGE_ALL}, or an L2 expression (`1d6+1`, `2`)
 *  resolved when the boundary is crossed — never at derive time, so a die is rolled at the moment
 *  the charges are regained (`effects/recharge-amount.ts`). */
export type RechargeAmount = string;

export interface RechargePolicy {
	trigger: RechargeTrigger;
	amount: RechargeAmount;
}

/** The one-word policies an `effects` cell may still say, and what each one means in the model. */
export type Recharge = 'short' | 'long' | 'short_one' | 'consumable' | 'other';

const SUGAR: Record<Recharge, RechargePolicy> = {
	short: { trigger: 'short', amount: RECHARGE_ALL },
	long: { trigger: 'long', amount: RECHARGE_ALL },
	// the pattern this model exists for: "regain ONE use per short rest, all on a long rest" (2024
	// Second Wind, Channel Divinity) — a partial amount, not a third kind of rest
	short_one: { trigger: 'short', amount: '1' },
	consumable: { trigger: 'consumable', amount: RECHARGE_ALL },
	other: { trigger: 'other', amount: RECHARGE_ALL },
};

/** The grammar of a recharge cell: a trigger, optionally with the amount in parentheses.
 *  `short` · `short_one` · `dawn(1d6+1)` · `long(2)`. Parens rather than another `:` because a
 *  token's segments are colon-separated and an amount is an expression with its own punctuation. */
const RECHARGE_CELL = /^([a-z_]+)(?:\(([^()]*(?:\([^()]*\))?[^()]*)\))?$/i;

/** Read a recharge cell into the model. Returns undefined for anything the vocabulary does not
 *  know — the caller degrades that to an unparsed token rather than guessing a policy. */
export function parseRecharge(cell: string): RechargePolicy | undefined {
	const m = RECHARGE_CELL.exec(cell.trim());
	const word = m?.[1]?.toLowerCase();
	if (!word) return undefined;
	const amount = m?.[2]?.trim();
	if (!amount) return SUGAR[word as Recharge] ? { ...SUGAR[word as Recharge] } : triggerOnly(word);
	// an amount only means something at a boundary that comes round: "consumable(2)" is a
	// contradiction, and reading it as either half would be inventing the author's intent
	const trigger = asTrigger(word);
	if (!trigger || trigger === 'consumable' || trigger === 'other') return undefined;
	return { trigger, amount };
}

const asTrigger = (word: string): RechargeTrigger | undefined =>
	(RECHARGE_TRIGGERS as readonly string[]).includes(word) ? (word as RechargeTrigger) : undefined;

const triggerOnly = (word: string): RechargePolicy | undefined => {
	const trigger = asTrigger(word);
	return trigger ? { trigger, amount: RECHARGE_ALL } : undefined;
};

/**
 * What a rest gives this pool back: `'all'`, an amount expression, or `null` for nothing.
 *
 * A long rest is the bigger boundary — it refills everything a short rest would, in full, which is
 * what makes `short_one` regain one use on a short rest and the whole pool on a long one. A pool
 * that comes back at dawn does NOT come back because you slept: RAW ties it to the hour, and a rest
 * taken at noon is not dawn.
 */
export function restRecharge(
	policy: RechargePolicy,
	kind: 'short' | 'long',
): RechargeAmount | null {
	if (policy.trigger === 'consumable' || policy.trigger === 'other') return null;
	if (policy.trigger === 'dawn' || policy.trigger === 'dusk') return null;
	if (kind === 'long') return RECHARGE_ALL;
	return policy.trigger === 'short' ? policy.amount : null;
}

/** How GENEROUS a policy is, for the equal-max tie-break when two features grant the same pool: how
 *  often it comes round, then how much of it. */
export function rechargeRank(policy: RechargePolicy): number {
	const byTrigger: Record<RechargeTrigger, number> = {
		short: 5,
		dawn: 4,
		dusk: 4,
		long: 3,
		other: 1,
		consumable: 0,
	};
	const base = byTrigger[policy.trigger] ?? 1;
	// a full refill beats a partial one at the same boundary (Font of Inspiration over the base grant)
	return base * 2 + (policy.amount === RECHARGE_ALL ? 1 : 0);
}
