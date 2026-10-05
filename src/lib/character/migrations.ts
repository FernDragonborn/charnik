/*
 * The forward migrations of a saved character, keyed by the `schemaVersion` each upgrades FROM.
 * Pure data transforms: `repository.ts` runs them between the parse and the validation of every
 * file it reads, a snapshot included.
 */
import type { Migration, Versioned } from '../schema/version';

/** Snake-case the ID segment of a content ref `type:source:id` (only the id part — the `source`
 *  like "SRD 5.1" is display and left alone), or a bare skill id. Non-strings pass through. */
const snakeRef = (ref: unknown): unknown => {
	if (typeof ref !== 'string' || ref === '') return ref;
	const i = ref.lastIndexOf(':');
	return i === -1
		? ref.replace(/-/g, '_')
		: ref.slice(0, i + 1) + ref.slice(i + 1).replace(/-/g, '_');
};
const snakeRefs = (arr: unknown): unknown => (Array.isArray(arr) ? arr.map(snakeRef) : arr);

/**
 * E3 migration (v1→v2): content ids became snake_case, so a saved character's REFS are rewritten.
 * Build refs (species/classes/subclass/feats/inventory/spells/background/languages) + skill/expertise
 * arrays + the concentration ref are snaked. Runtime `play.effects` tokens are left as-is (user-entered,
 * ambiguous with the `-` minus operator; the user re-adds them) — a pragmatic, safe scope.
 */
const migrateV1toV2: Migration<Versioned> = (data) => {
	const d = data as unknown as Record<string, unknown>;
	const build = (d.build ?? {}) as Record<string, unknown>;
	const play = (d.play ?? {}) as Record<string, unknown>;
	for (const key of ['species', 'speciesOption', 'background'] as const)
		if (typeof build[key] === 'string') build[key] = snakeRef(build[key]);
	// `languages` holds `language:src:id` refs and predates the rename by twelve days — left out of
	// this list, a v1 save silently lost every language whose id was kebab-cased
	for (const key of ['feats', 'skills', 'expertise', 'languages'] as const)
		build[key] = snakeRefs(build[key]);
	// spells are `{spell: ref, …}` objects, not bare refs
	if (Array.isArray(build.spells))
		build.spells = build.spells.map((s) => {
			const ss = s as Record<string, unknown>;
			return { ...ss, spell: snakeRef(ss.spell) };
		});
	if (Array.isArray(build.classes))
		build.classes = build.classes.map((c) => {
			const cc = c as Record<string, unknown>;
			return { ...cc, class: snakeRef(cc.class), subclass: snakeRef(cc.subclass) };
		});
	if (Array.isArray(build.inventory))
		build.inventory = build.inventory.map((it) => {
			const ii = it as Record<string, unknown>;
			return { ...ii, item: snakeRef(ii.item) };
		});
	if (typeof play.concentration === 'string') play.concentration = snakeRef(play.concentration);
	if (Array.isArray(play.effects))
		play.effects = play.effects.map((e) => {
			const ee = e as Record<string, unknown>;
			return typeof ee.source === 'string' ? { ...ee, source: snakeRef(ee.source) } : ee;
		});
	return { ...d, build, play, schemaVersion: 2 } as unknown as Versioned;
};

/**
 * v2→v3: re-run the SAME ref-snaking. Why: the seeded DEMO character was written at v2 with
 * kebab refs (demo/sheet.ts predated the E3 id rename but was never migrated — it is built fresh,
 * so migrateV1toV2 never saw it). snakeRef is idempotent on already-snake ids, so re-running is
 * safe for every legitimate v2 save; only stale kebab refs change.
 */
const migrateV2toV3: Migration<Versioned> = (data) => ({
	...(migrateV1toV2(data) as unknown as Record<string, unknown>),
	schemaVersion: 3,
});

/** Forward migrations keyed by the version they upgrade FROM. */
export const CHARACTER_MIGRATIONS: Record<number, Migration<Versioned>> = {
	1: migrateV1toV2,
	2: migrateV2toV3,
};
