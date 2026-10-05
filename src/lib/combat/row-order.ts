/*
 * A player's own order for a panel's rows.
 *
 * The inventory needs none of this — its rows ARE `build.inventory`, so the array is the order. These
 * are the lists that are DERIVED (attacks from what you wield, actions from what you can do): there is
 * no array to reorder, so the order is stored beside them, on the character's `ui`.
 *
 * Reconciled in both directions on every read, the same rule the panel columns use: a row the saved
 * order does not name is new and goes to the end, and a name with no row left is dropped. Neither is
 * something a player could fix from the app if it went wrong.
 *
 * Skills, spells and effects keep no order of their own on purpose: their order IS their grouping
 * (by ability, by level, by polarity), and features are ordered only inside their section.
 */

/** The panels that keep a stored row order — compared against these, never a bare string. */
export const ROW_PANEL = { attacks: 'attacks', actions: 'actions', features: 'features' } as const;

/** Sort `rows` by a saved order, keeping anything unnamed in its own order at the end. */
export function orderRows<T>(
	rows: readonly T[],
	idOf: (row: T) => string,
	saved: readonly string[] | undefined,
): T[] {
	if (!saved?.length) return [...rows];
	const rank = new Map(saved.map((id, at) => [id, at]));
	const named = rows.filter((row) => rank.has(idOf(row)));
	const rest = rows.filter((row) => !rank.has(idOf(row)));
	named.sort((a, b) => (rank.get(idOf(a)) ?? 0) - (rank.get(idOf(b)) ?? 0));
	return [...named, ...rest];
}

/** The order after moving one row a step — `-1` up, `1` down. Unchanged at either end. */
export function movedOrder(ids: readonly string[], id: string, by: -1 | 1): string[] {
	const order = [...ids];
	const at = order.indexOf(id);
	const to = at + by;
	const swapped = order[to];
	if (at < 0 || to < 0 || to >= order.length || swapped === undefined) return order;
	order[to] = id;
	order[at] = swapped;
	return order;
}

/**
 * One key per row for a list whose ids may repeat — an attack is named for its weapon, and the same
 * weapon can stand on two inventory rows. The first holder keeps the id as it is, so a saved order
 * still finds it; a repeat gets `<id>#2`, `#3`. A keyed list given the same key twice does not
 * render one row short: it takes the whole panel down.
 */
export function uniqueRowKeys(ids: readonly string[]): string[] {
	const seen = new Map<string, number>();
	return ids.map((id) => {
		const nth = (seen.get(id) ?? 0) + 1;
		seen.set(id, nth);
		return nth === 1 ? id : `${id}#${nth}`;
	});
}
