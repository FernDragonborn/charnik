/*
 * Total-record construction. One helper, because the alternative was spelled out at eight sites:
 * `const r = {} as Record<Ability, X>` followed by a loop that fills it. That seed claims every key
 * before a single one exists, so anything reading it in between type-checks and is undefined —
 * which is exactly the escape hatch `consistent-type-assertions` exists to close (PLAN · LINT-1).
 */

/**
 * Build a `Record<K, V>` that has EVERY key in `keys`, computing each value from its key.
 *
 * The assertion inside is on `Object.fromEntries`' return type, which TypeScript widens to
 * `{ [k: string]: V }` regardless of the input keys — it is a limitation of that signature, not a
 * claim about a half-built object.
 */
export const recordOf = <K extends string, V>(
	keys: readonly K[],
	valueFor: (key: K) => V,
): Record<K, V> => Object.fromEntries(keys.map((k) => [k, valueFor(k)])) as Record<K, V>;

/**
 * The count a partial map holds under `key`, where the key is one CONTENT names — a resource id.
 *
 * A plain object answers for every name its prototype has, so `counts['constructor']` on a map
 * that holds no such entry is `Object`'s own constructor rather than nothing, and `constructor` is
 * a perfectly valid content id. Asking whether the key is the map's OWN is the whole of the fix;
 * a map indexed only by a closed set of keys (an ability, a slot level) has no need of it.
 */
export const countAt = (
	counts: Readonly<Record<string, number>> | undefined,
	key: string,
): number => (counts && Object.hasOwn(counts, key) ? (counts[key] ?? 0) : 0);
