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
	bumpQty,
	isEquippable,
	removeItem,
	toggleEquipped,
} from '$lib/character/inventory';
import { resolveItem, type ResolvedItem } from '$lib/content/resolved-item';
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

	add = (ref: string): void => this.put(addItem(this.host().draft.inventory, ref));
	remove = (ref: string): void => this.put(removeItem(this.host().draft.inventory, ref));
	bumpQty = (ref: string, by: number): void =>
		this.put(bumpQty(this.host().draft.inventory, ref, by));
	toggleEquipped = (ref: string): void =>
		this.put(toggleEquipped(this.host().draft.inventory, ref));

	/** An item as the sheet reads it — its own tags plus whatever it inherits from its base item. The
	 *  graph lives on the host, so no component resolves an item itself and reads a +1 plate's AC off
	 *  its own (empty) tags. */
	resolved = (id: string | null): ResolvedItem | undefined => {
		const host = this.host();
		const row = rowOfType(host.row(id), 'item');
		return row && host.graph ? resolveItem(host.graph, row) : undefined;
	};

	/** Can this be equipped (armour / shield / weapon)? */
	equippable = (ref: string): boolean => isEquippable(this.resolved(ref));
}
