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
