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

/** Move the slot keys a class row owns under its INDEX (`0:4`) onto its id (`<rowId>:4`), in every
 *  map given. Shared with the builder, whose stored drafts are keyed the same two ways. */
export function moveSlotKeysToRow(
	maps: Record<string, unknown>[],
	index: number,
	rowId: string,
): void {
	for (const map of maps)
		for (const key of Object.keys(map)) {
			const [prefix, level] = key.split(':');
			if (prefix !== String(index) || !level) continue;
			map[`${rowId}:${level}`] = map[key];
			delete map[key];
		}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * v3→v4: identities. The character gets a `uid`, every inventory row an `iid`, and every class row
 * the `rowId` its slot picks are keyed by — a row saved while those keys named its INDEX takes them
 * with it. Whatever already carries an id keeps it.
 */
const migrateV3toV4: Migration<Versioned> = (data) => {
	const d = data as unknown as Record<string, unknown>;
	const build = isRecord(d.build) ? d.build : {};
	const slotMaps = isRecord(build.slotPicks) ? Object.values(build.slotPicks).filter(isRecord) : [];
	if (Array.isArray(build.classes))
		build.classes = build.classes.map((row: unknown, index) => {
			if (!isRecord(row) || (typeof row.rowId === 'string' && row.rowId !== '')) return row;
			const rowId = crypto.randomUUID();
			moveSlotKeysToRow(slotMaps, index, rowId);
			return { ...row, rowId };
		});
	if (Array.isArray(build.inventory))
		build.inventory = build.inventory.map((row: unknown) =>
			isRecord(row) ? { iid: crypto.randomUUID(), ...row } : row,
		);
	return { uid: crypto.randomUUID(), ...d, build, schemaVersion: 4 } as unknown as Versioned;
};

/** Forward migrations keyed by the version they upgrade FROM. */
export const CHARACTER_MIGRATIONS: Record<number, Migration<Versioned>> = {
	1: migrateV1toV2,
	2: migrateV2toV3,
	3: migrateV3toV4,
};
