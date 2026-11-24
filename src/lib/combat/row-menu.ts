/*
 * What a row's menu offers (`work/play-layout.md` ▸ ROW-MENU): the one place a row's secondary acts
 * live — why its number is what it is, the roll's swing, its pin, the compendium, and the row's own
 * acts. A panel says what its row has; the menu shows only that.
 */
import { BASE_PATH } from '#lib/config/base-path.ts';
import { compendiumEntryPath } from '#lib/content/detail.ts';

/** Which way a player swings a d20 test from the menu: against the sheet's own reading of it. */
export const ROLL_SWING = { disadvantage: -1, straight: 0, advantage: 1 } as const;
export type RollSwing = (typeof ROLL_SWING)[keyof typeof ROLL_SWING];

export interface RowMenuAct {
	label: string;
	run: (event: MouseEvent) => void;
	/** Something gone for good — framed as the irreversible answer. */
	gone?: boolean;
}

export interface RowMenuSpec {
	/** The row's name, the menu's heading. */
	title: string;
	/** What the number is made of — the row's provenance, one line per part. */
	why?: string;
	/** A d20 test rolled with the player's swing added to whatever the sheet already applies. */
	roll?: (swing: RollSwing) => void;
	pin?: { on: boolean; toggle: () => void };
	/** The row's own article. */
	compendium?: string | undefined;
	words?: { rowId: string; original: string };
	acts?: RowMenuAct[];
}

/** A row's article in the compendium, from its `type:source:id`; none for a ref of another shape. */
export function articleHref(ref: string): string | undefined {
	const first = ref.indexOf(':');
	const last = ref.lastIndexOf(':');
	if (first < 0 || last <= first) return undefined;
	return compendiumEntryPath(
		BASE_PATH,
		ref.slice(0, first),
		ref.slice(first + 1, last),
		ref.slice(last + 1),
	);
}
