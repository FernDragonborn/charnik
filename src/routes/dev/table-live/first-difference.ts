/**
 * Where two JSON values first differ, as a path, or null when they hold the same. The order of an
 * object's keys is not a difference: the wire's Rust side keeps a map sorted, so what arrives is
 * the same sheet with its fields in another order.
 */
export function firstDifference(sent: unknown, arrived: unknown, path: string): string | null {
	if (
		typeof sent !== 'object' ||
		typeof arrived !== 'object' ||
		sent === null ||
		arrived === null ||
		Array.isArray(sent) !== Array.isArray(arrived)
	)
		return sent === arrived ? null : path;
	const here = new Map<string, unknown>(Object.entries(sent));
	const there = new Map<string, unknown>(Object.entries(arrived));
	for (const key of new Set([...here.keys(), ...there.keys()])) {
		const at = firstDifference(here.get(key), there.get(key), `${path}.${key}`);
		if (at !== null) return at;
	}
	return null;
}
