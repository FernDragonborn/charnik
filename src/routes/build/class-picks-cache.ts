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
import type { Ability } from '$lib/rules/core';
import type { AsiShape, DraftState } from './draft';

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

/** `2:4` → `4` for row 2; anything belonging to another row is not this class's business. */
const levelOfSlotKey = (key: string, row: number): string | null => {
	const [prefix, level] = key.split(':');
	return prefix === String(row) && level ? level : null;
};

/** Read out everything row `row` owns. Returns `null` when that row holds no class yet. */
export function stashClassPicks(draft: DraftState, row: number): ClassScopedPicks | null {
	const entry = draft.classes[row];
	if (!entry?.classId) return null;
	/** `{ '2:4': x }` → `{ '4': x }`, keeping only what row `row` owns. */
	const byLevel = <T>(source: Record<string, T>): Record<string, T> =>
		Object.fromEntries(
			Object.entries(source).flatMap(([key, value]) => {
				const level = levelOfSlotKey(key, row);
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

/** Drop everything row `row` owns, so a class arriving with nothing cached starts clean. */
export function clearClassPicks(draft: DraftState, row: number): void {
	const drop = (source: Record<string, unknown>) => {
		for (const key of Object.keys(source)) if (levelOfSlotKey(key, row)) delete source[key];
	};
	drop(draft.slotFeats);
	drop(draft.slotAsi);
	drop(draft.slotFeatAbility);
	drop(draft.slotFeatSkills);
	if (draft.classes.length === 1) {
		draft.skills = [];
		draft.expertise = [];
		draft.selectedSpells = [];
	}
}

/** Put a stashed set back on row `row`, re-keying the slot maps to that row. */
export function restoreClassPicks(draft: DraftState, row: number, picks: ClassScopedPicks): void {
	const put = <T>(target: Record<string, T>, source: Record<string, T>) => {
		for (const [level, value] of Object.entries(source)) target[`${row}:${level}`] = value;
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

/** Put `classId` in row `row`: stash what is leaving, clear the row, hand back what is returning. */
export function switchClass(
	draft: DraftState,
	row: number,
	classId: string | null,
	cache: Map<string, ClassScopedPicks>,
): void {
	const leaving = draft.classes[row]?.classId ?? null;
	if (leaving === classId) return;
	const stashed = stashClassPicks(draft, row);
	if (leaving && stashed) cache.set(leaving, stashed);
	clearClassPicks(draft, row);
	draft.classes = draft.classes.map((c, i) =>
		i === row ? { ...c, classId, subclassId: null } : c,
	);
	const returning = classId ? cache.get(classId) : undefined;
	if (returning) restoreClassPicks(draft, row, returning);
}
