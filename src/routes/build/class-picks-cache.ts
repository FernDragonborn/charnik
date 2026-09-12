/*
 * What a class choice OWNS in the draft, stashed so switching away and back does not destroy it.
 *
 * Switching the class in a row used to null the subclass and leave every feat/ASI pick behind under
 * a key that names the ROW, not the class — so a Barbarian's level-4 feat stayed attached when the
 * row became a Wizard, and the Wizard's subclass was gone for good. Both are the same defect: the
 * draft has no idea which of its fields belong to which class.
 *
 * Pure and Svelte-free so it can be unit-tested without a runtime; the view-model owns the Map.
 */
import { z } from 'zod';
import { MAX_CHARACTER_LEVEL } from '$lib/build/rules';
import type { Ability } from '$lib/rules/core';
import { slotMapSchemas, type AsiShape, type DraftState } from './draft';

/** Everything in the draft that belongs to one class row's class choice. */
export interface ClassScopedPicks {
	subclassId: string | null;
	level: number;
	/** Slot picks keyed by LEVEL only — the draft keys them `${row}:${level}`, and a class can come
	 *  back into a different row, so the row prefix is stripped on the way in and re-applied on the
	 *  way out. */
	slotFeats: Record<string, string>;
	slotAsi: Record<string, { shape: AsiShape; picks: Ability[] }>;
	slotFeatAbility: Record<string, Ability>;
	slotFeatSkills: Record<string, string[]>;
	/**
	 * Shared pools, carried only while the draft has a single class row. With two classes these are
	 * one pool fed by both, so restoring a snapshot of them would silently discard the other class's
	 * picks — losing a little on a multiclass switch beats destroying someone else's list.
	 */
	shared: { skills: string[]; expertise: string[]; selectedSpells: string[] } | null;
}

/**
 * The stash as it comes back off disk, beside the draft it belongs to and read the same way: parsed,
 * never cast. An entry that will not parse is DROPPED rather than repaired — a stash exists only to
 * make switching a class free, and a half-read one hands a class back picks that are not its own.
 */
const classScopedPicksSchema: z.ZodType<ClassScopedPicks> = z.object({
	subclassId: z.string().nullable().catch(null),
	level: z.number().int().min(1).max(MAX_CHARACTER_LEVEL).catch(1),
	slotFeats: slotMapSchemas.feats.catch(() => ({})),
	slotAsi: slotMapSchemas.asi.catch(() => ({})),
	slotFeatAbility: slotMapSchemas.ability.catch(() => ({})),
	slotFeatSkills: slotMapSchemas.skills.catch(() => ({})),
	shared: z
		.object({
			skills: z.array(z.string()).catch(() => []),
			expertise: z.array(z.string()).catch(() => []),
			selectedSpells: z.array(z.string()).catch(() => []),
		})
		.nullable()
		.catch(null),
});

export function parseClassPicks(value: unknown): Map<string, ClassScopedPicks> {
	if (!Array.isArray(value)) return new Map();
	const entry = z.tuple([z.string(), classScopedPicksSchema]);
	return new Map(
		value.flatMap((raw) => {
			const parsed = entry.safeParse(raw);
			return parsed.success ? [parsed.data] : [];
		}),
	);
}

/** `<rowId>:4` → `4` for that row; anything belonging to another row is not this class's business. */
const levelOfSlotKey = (key: string, rowId: string): string | null => {
	const [prefix, level] = key.split(':');
	return prefix === rowId && level ? level : null;
};

/** Read out everything row `row` owns. Returns `null` when that row holds no class yet. */
export function stashClassPicks(draft: DraftState, row: number): ClassScopedPicks | null {
	const entry = draft.classes[row];
	if (!entry?.classId) return null;
	/** `{ '<rowId>:4': x }` → `{ '4': x }`, keeping only what this row owns. */
	const byLevel = <T>(source: Record<string, T>): Record<string, T> =>
		Object.fromEntries(
			Object.entries(source).flatMap(([key, value]) => {
				const level = levelOfSlotKey(key, entry.rowId);
				return level ? [[level, value] as const] : [];
			}),
		);
	return {
		subclassId: entry.subclassId,
		level: entry.level,
		slotFeats: byLevel(draft.slotFeats),
		slotAsi: byLevel(draft.slotAsi),
		slotFeatAbility: byLevel(draft.slotFeatAbility),
		slotFeatSkills: byLevel(draft.slotFeatSkills),
		shared:
			draft.classes.length === 1
				? {
						skills: [...draft.skills],
						expertise: [...draft.expertise],
						selectedSpells: [...draft.selectedSpells],
					}
				: null,
	};
}

/** Drop the slot picks row `rowId` owns, so a class arriving with nothing cached starts clean. */
export function dropRowSlots(draft: DraftState, rowId: string): void {
	const drop = (source: Record<string, unknown>) => {
		for (const key of Object.keys(source)) if (levelOfSlotKey(key, rowId)) delete source[key];
	};
	drop(draft.slotFeats);
	drop(draft.slotAsi);
	drop(draft.slotFeatAbility);
	drop(draft.slotFeatSkills);
}

/** Put a stashed set back on a row, re-keying the slot maps to it. */
export function restoreClassPicks(draft: DraftState, row: number, picks: ClassScopedPicks): void {
	const rowId = draft.classes[row]?.rowId;
	if (!rowId) return;
	const put = <T>(target: Record<string, T>, source: Record<string, T>) => {
		for (const [level, value] of Object.entries(source)) target[`${rowId}:${level}`] = value;
	};
	put(draft.slotFeats, picks.slotFeats);
	put(draft.slotAsi, picks.slotAsi);
	put(draft.slotFeatAbility, picks.slotFeatAbility);
	put(draft.slotFeatSkills, picks.slotFeatSkills);
	if (picks.shared && draft.classes.length === 1) {
		draft.skills = [...picks.shared.skills];
		draft.expertise = [...picks.shared.expertise];
		draft.selectedSpells = [...picks.shared.selectedSpells];
	}
	draft.classes = draft.classes.map((c, i) =>
		i === row ? { ...c, subclassId: picks.subclassId, level: picks.level } : c,
	);
}

/**
 * Take row `row` off the draft.
 *
 * The rows behind it need nothing done to them: a slot key names the row's own id, not its place in
 * the list, so removing one out of the middle cannot move anybody else's picks onto it.
 *
 * The leaving class's picks go to the cache like a swap's do — removing a row is another way of
 * saying "not this one", and it costs the same nothing if the class comes back.
 */
export function removeClassRow(
	draft: DraftState,
	row: number,
	cache: Map<string, ClassScopedPicks>,
): void {
	if (row <= 0 || row >= draft.classes.length) return; // row 0 is the primary and always stays
	const entry = draft.classes[row];
	if (!entry) return;
	const leavingPicks = stashClassPicks(draft, row);
	if (entry.classId && leavingPicks) cache.set(entry.classId, leavingPicks);
	dropRowSlots(draft, entry.rowId);
	draft.classes = draft.classes.filter((_, i) => i !== row);
}

/** Put `classId` in row `row`: stash what is leaving, clear the row, hand back what is returning. */
export function switchClass(
	draft: DraftState,
	row: number,
	classId: string | null,
	cache: Map<string, ClassScopedPicks>,
): void {
	// A picker opened on a row that has since been removed still applies to the index it captured.
	// Without this the row is missing, so nothing is stashed and no class is written — but the clear
	// below still runs, and on a single-class draft it empties the skills, expertise and spells for a
	// click that appeared to do nothing at all.
	if (row < 0 || row >= draft.classes.length) return;
	const leaving = draft.classes[row]?.classId ?? null;
	if (leaving === classId) return;
	const stashed = stashClassPicks(draft, row);
	if (leaving && stashed) cache.set(leaving, stashed);
	dropRowSlots(draft, draft.classes[row]?.rowId ?? '');
	// the shared pools belong to whoever is in the draft, so they only empty when the ONE class that
	// could have filled them is the class LEAVING — picking a first class empties nothing, because
	// nothing was stashed to hand back and the skills were chosen before any class was there to own them
	if (leaving && draft.classes.length === 1) {
		draft.skills = [];
		draft.expertise = [];
		draft.selectedSpells = [];
	}
	draft.classes = draft.classes.map((c, i) =>
		i === row ? { ...c, classId, subclassId: null } : c,
	);
	const returning = classId ? cache.get(classId) : undefined;
	if (returning) restoreClassPicks(draft, row, returning);
}
