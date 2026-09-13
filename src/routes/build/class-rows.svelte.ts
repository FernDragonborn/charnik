/*
 * The multiclass rows: which class each row holds, at what level, and every guard over adding,
 * swapping, levelling and dropping one.
 *
 * The mutation half of a swap lives in `class-picks-cache` (what the outgoing class stashes and the
 * returning one takes back); this is its reactive face, plus the two caps that must agree — the
 * character level cap, and what a played character has already settled under Strict.
 */
import { toast } from 'svelte-sonner';
import { t } from '$lib/i18n';
import { MAX_CHARACTER_LEVEL } from '$lib/build/rules';
import { newClassRow } from './draft';
import { removeClassRow, switchClass } from './class-picks-cache';
import type { BuildVM } from './build-view-model.svelte';

/**
 * What the rows need from the build view-model around them. `import type` is erased, so picking the
 * shape off the class costs no runtime cycle and cannot drift from it.
 *
 * The pane is the one member described structurally instead of picked: the inspector's own host
 * picks `classRows` off the view-model, so two `Pick`s naming each other is a type cycle TypeScript
 * refuses to resolve. Dropping a row only ever asks it what it is open on, and to close.
 */
export type ClassRowsHost = Pick<BuildVM, 'draft' | 'settledDraft' | 'classPicks'> & {
	inspector: { target: { id: string } | null; close: () => void };
};

export class ClassRows {
	/* The host arrives as an ACCESSOR: a `$derived` field initialiser runs before a constructor
	   parameter property is assigned, so a direct reference reads it before it exists. */
	constructor(private host: () => ClassRowsHost) {}

	/** Row 0's class. RAW it is the one that drives the saving throws, the skill list and the ASI. */
	primaryClassId = $derived.by<string | null>(() => this.host().draft.classes[0]?.classId ?? null);
	/** Total character level = sum of all class levels (drives prof, HP, feat slots). */
	totalLevel = $derived.by(
		() => this.host().draft.classes.reduce((n, c) => n + (c.classId ? c.level : 0), 0) || 1,
	);
	/** Character level is capped at 20 total across all classes. */
	canRaiseLevel = $derived.by(() => this.totalLevel < MAX_CHARACTER_LEVEL);

	/** That row as the character arrived with it, or `undefined` for a row added since. */
	private settledRow = (i: number) => {
		const rowId = this.host().draft.classes[i]?.rowId;
		return rowId ? this.host().settledDraft?.classes.find((c) => c.rowId === rowId) : undefined;
	};
	/** Can this row's level go DOWN? Never below the level the character has already played. */
	canLowerLevel = (i: number): boolean =>
		(this.host().draft.classes[i]?.level ?? 1) > Math.max(this.settledRow(i)?.level ?? 1, 1);
	/** Can this row be dropped? A class the character already has is not un-taken at a level-up. */
	canRemoveClass = (i: number): boolean => i > 0 && !this.settledRow(i)?.classId;

	addClass = () => {
		if (!this.canRaiseLevel) return; // a new class starts at 1 → would exceed the cap
		this.host().draft.classes = [...this.host().draft.classes, newClassRow()];
	};
	/** Drop a class row, re-keying what the rows behind it own — see `class-picks-cache`. */
	removeClass = (i: number) => {
		if (!this.canRemoveClass(i)) return;
		removeClassRow(this.host().draft, i, this.host().classPicks);
		// every row after `i` moves down one, so a pane open on a class or a subclass is now about a
		// different row — and the one that was removed is about nothing at all
		const open = this.host().inspector.target?.id;
		if (open === 'class' || open === 'subclass') this.host().inspector.close();
	};
	/**
	 * Change the class in row `i`, stashing what the outgoing one owned under its own ref and handing
	 * it straight back if it returns — so trying a class costs nothing (see `class-picks-cache`).
	 *
	 * The cap is checked HERE and not only where a level is raised: an empty row contributes nothing
	 * to `totalLevel`, so a draft at 20 can still hold one, and filling it is the one way past 20 that
	 * nothing downstream clamps.
	 */
	setClass = (i: number, id: string | null) => {
		if (id && this.levelAfterTaking(i, id) > MAX_CHARACTER_LEVEL) {
			toast(t('build.notice.levelCapFull', { cap: MAX_CHARACTER_LEVEL }));
			return;
		}
		switchClass(this.host().draft, i, id, this.host().classPicks);
	};
	/** What the character's total level becomes if row `i` takes `id` — a class that is coming back
	 *  brings the level it left with, not the level the row shows now. */
	private levelAfterTaking(i: number, id: string): number {
		const row = this.host().draft.classes[i];
		// summed here rather than borrowed from `totalLevel`, whose `|| 1` is a DISPLAY floor: with no
		// class held anywhere it reads 1 instead of 0, so taking the first class computed as level + 1
		// and a row the stepper had walked to 20 could never be filled at all
		const others = this.host()
			.draft.classes.reduce((n, c, j) => n + (c.classId && j !== i ? c.level : 0), 0);
		return others + (this.host().classPicks.get(id)?.level ?? row?.level ?? 1);
	}
	setSubclass = (i: number, id: string | null) => {
		this.host().draft.classes = this.host().draft.classes.map((c, idx) =>
			idx === i ? { ...c, subclassId: id } : c,
		);
	};
	bumpClassLevel = (i: number, dir: 1 | -1) => {
		if (dir === 1 && !this.canRaiseLevel) return; // total character level cap
		if (dir === -1 && !this.canLowerLevel(i)) return; // level 1, or a level already played (Strict)
		this.host().draft.classes = this.host().draft.classes.map((c, idx) =>
			idx === i ? { ...c, level: Math.max(1, Math.min(MAX_CHARACTER_LEVEL, c.level + dir)) } : c,
		);
	};
}
