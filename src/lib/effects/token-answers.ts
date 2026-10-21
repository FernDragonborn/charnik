/*
 * Where a row's tokens take the PLAYER's answer: an item's (`item_choice`, answered on its inventory
 * entry) and an option pick's (`option_choice`, answered in the build). Substituted before the token
 * is parsed, so every consumer downstream reads a finished token.
 */
/**
 * The word a row writes where the PLAYER's answer goes — `damage_sensitivity:resist:item_choice` on
 * Ring of Resistance, whose gemstone names a type the shared content row cannot.
 *
 * `item_bonus` is a NUMBER, so it rides the L2 expression in a value slot. A damage type is not a
 * number and lands in a target slot, where there is no expression to evaluate — so the answer is
 * substituted into the token before it is parsed, one whole segment at a time. That keeps the
 * grammar unchanged: every consumer downstream reads `damage_sensitivity:resist:fire`, and the
 * parse cache keys on the substituted string rather than on a template that means two things.
 */
const ITEM_CHOICE = 'item_choice';

/**
 * Point a carried item's tokens at the choice this instance was answered with.
 *
 * An UNANSWERED row grants nothing: its `item_choice` tokens are dropped rather than folded onto
 * the word itself, for the same reason an unanswered `item_bonus` reads 0 — the app does not pick a
 * damage type on the player's behalf, and the chooser sits on the inventory row where the item is.
 * A token that does not name the placeholder is untouched, so Dragon Scale Mail's own `+1` to AC
 * still folds while its resistance waits for an answer.
 */
export function withItemChoice(tokens: string[], choice: string | undefined): string[] {
	const out: string[] = [];
	for (const token of tokens) {
		const segments = token.split(':');
		if (!segments.includes(ITEM_CHOICE)) {
			out.push(token);
			continue;
		}
		if (choice) out.push(segments.map((seg) => (seg === ITEM_CHOICE ? choice : seg)).join(':'));
	}
	return out;
}

/**
 * The word an OPTION's row writes where one pick's answer goes — 2024 Agonizing Blast's
 * `flat_bonus:damage.option_choice+cha_mod`, scoped to whichever cantrip that pick named. Its own
 * word rather than `item_choice`, because it answers a different question in a different place,
 * and it sits INSIDE a segment (a scope), so it is replaced as a whole word rather than a whole
 * segment. Unanswered, the token is dropped, as an unanswered item's is.
 */
const OPTION_CHOICE = /\boption_choice\b/g;

export function withOptionChoice(tokens: string[], answer: string | undefined): string[] {
	const out: string[] = [];
	for (const token of tokens) {
		if (!token.match(OPTION_CHOICE)) out.push(token);
		else if (answer) out.push(token.replace(OPTION_CHOICE, answer));
	}
	return out;
}
