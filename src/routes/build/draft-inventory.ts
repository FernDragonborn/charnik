/*
 * What the builder does to the character's kit.
 *
 * Every method has the same shape: take the draft's inventory, hand it to the shared list semantics
 * in `$lib/character/inventory` — the combat sheet's panel uses the same ones — and put the result
 * back. What differs between the two places is only which list they act on, so the rules stay in one
 * module and this one is the seam onto the draft.
 *
 * A plain class, not a rune module: it holds no state of its own and reads everything through the
 * host, so the reactivity it needs is the draft's.
 */
import {
	addItem,
	addItemInstance,
	answerItem,
	bumpQty,
	isEquippable,
	removeItem,
	removeItemsOf,
	toggleEquipped,
	wornSlotIn,
} from '$lib/character/inventory';
import { resolveItem, type ResolvedItem } from '$lib/content/resolved-item';
import {
	instanceQuestions,
	type InstanceAnswers,
	type InstanceQuestions,
} from '$lib/content/item-instance';
import { carriedName } from '$lib/combat/carried-name';
import { isRowActive } from '$lib/content/sources.svelte';
import { translator } from '$lib/i18n';
import { app } from '$lib/stores/app.svelte';
import type { BuildVM } from './build-view-model.svelte';
import { rowOfType } from './rows';
import type { DraftState } from './draft';

/** What this needs from the view-model around it — picked off the class, so it cannot drift from
 *  what the class actually offers. `import type` is erased, so no runtime cycle. */
export type DraftInventoryHost = Pick<BuildVM, 'draft' | 'graph' | 'row'>;

export class DraftInventory {
	constructor(private host: () => DraftInventoryHost) {}

	private put(next: DraftState['inventory']): void {
		this.host().draft.inventory = next;
	}

	// the picker speaks of an ITEM — take it, put it back; a row on the sheet is spoken of by its own id
	add = (ref: string): void => this.put(addItem(this.host().draft.inventory, ref));
	/** Carry one particular instance, its questions answered as it was taken. */
	addInstance = (ref: string, answers: InstanceAnswers): void =>
		this.put(addItemInstance(this.host().draft.inventory, ref, answers));
	putBack = (ref: string): void => this.put(removeItemsOf(this.host().draft.inventory, ref));
	/** Answer again which one a carried row is — asked from its own name on the sheet. */
	reanswer = (row: string, answers: InstanceAnswers): void =>
		this.put(answerItem(this.host().draft.inventory, row, answers));
	remove = (row: string): void => this.put(removeItem(this.host().draft.inventory, row));
	bumpQty = (row: string, by: number): void =>
		this.put(bumpQty(this.host().draft.inventory, row, by));
	toggleEquipped = (row: string): void =>
		this.put(toggleEquipped(this.host().draft.inventory, row, wornSlotIn(this.host().graph)));

	/** An item as the sheet reads it — its own tags plus whatever it inherits from its base item. The
	 *  graph lives on the host, so no component resolves an item itself and reads a +1 plate's AC off
	 *  its own (empty) tags. */
	resolved = (id: string | null, base?: string): ResolvedItem | undefined => {
		const host = this.host();
		const row = rowOfType(host.row(id), 'item');
		return row && host.graph ? resolveItem(host.graph, row, base) : undefined;
	};

	/** What a carried row is called — the same name the play sheet gives it (`carriedName`). */
	nameOf = (entry: DraftState['inventory'][number]): string => {
		const { graph } = this.host();
		const row = rowOfType(this.host().row(entry.item), 'item');
		return row && graph
			? carriedName({ graph, locale: app.activeLocale }, row, entry, translator())
			: entry.item;
	};

	/** What a carried row can be asked again — which item, which +N, which kind. */
	questionsOf = (ref: string): InstanceQuestions => {
		const { graph, draft } = this.host();
		const row = rowOfType(this.host().row(ref), 'item');
		return row && graph
			? instanceQuestions(
					{ graph, system: draft.system, locale: app.activeLocale, isActive: isRowActive },
					row,
				)
			: { bases: [], rungs: [], choices: [] };
	};

	/** Can this be equipped (armour / shield / weapon)? */
	equippable = (ref: string): boolean => isEquippable(this.resolved(ref));
}
