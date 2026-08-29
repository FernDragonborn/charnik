/*
 * The inventory subsystem of the Combat view-model: what the character is carrying mid-session, and
 * the four things play does to it — equip, attune, change how many, use one up. Split out of
 * CombatVM the way the resource tracker and the turn economy are; CombatVM composes it as
 * `combat.inventory`, passing getters for the reactive character / graph / sheet.
 *
 * The list semantics live in `$lib/character/inventory` (shared with the builder). What is here is
 * the reactive projection the panel renders and the two rules that only apply at play time: the
 * attunement cap, and using a consumable up.
 */
import { toast } from 'svelte-sonner';
import {
	ATTUNEMENT_CAP,
	attunedCount,
	bumpQty,
	carriedWeight,
	isConsumable,
	isEquippable,
	needsAttunement,
	toggleAttuned,
	toggleEquipped,
	useOne,
	type InventoryEntry,
} from '$lib/character/inventory';
import { resolveItem, type ResolvedItem } from '$lib/content/resolved-item';
import { rowName, type ContentGraph } from '$lib/content/loader';
import { tagInt, ITEM_TAG } from '$lib/content/item-tags';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';

/** One carried thing, as the panel reads it. Everything the row needs, resolved once. */
export interface InventoryRow {
	entry: InventoryEntry;
	name: string;
	item: ResolvedItem | undefined;
	/** Pounds for ONE of it — the row shows the stack's weight, the sum uses qty. */
	weightLb: number;
	/** The one-line "what is this" the row prints under the name: category, damage, AC. */
	meta: string;
	equippable: boolean;
	consumable: boolean;
	attunable: boolean;
}

export class InventoryTracker {
	constructor(
		private getCharacter: () => Character | null,
		private getGraph: () => ContentGraph | null,
		private getSheet: () => CharacterSheet | null,
	) {}

	private resolve = (ref: string): ResolvedItem | undefined => {
		const graph = this.getGraph();
		if (!graph) return undefined;
		const row = graph.get(ref);
		return row?.type === 'item' ? resolveItem(graph, row) : undefined;
	};

	private get list(): InventoryEntry[] {
		return this.getCharacter()?.build.inventory ?? [];
	}

	rows = $derived.by<InventoryRow[]>(() => {
		const c = this.getCharacter();
		if (!c) return [];
		return c.build.inventory.map((entry) => {
			const item = this.resolve(entry.item);
			const ac = item ? tagInt(item.tags, ITEM_TAG.ac) : null;
			return {
				entry,
				// the ref itself is the last resort: a row whose item left the graph must still be
				// visible and removable, never a blank line the user cannot act on
				name: item ? rowName(item.row) : entry.item,
				item,
				weightLb: Number(item?.row.data.weight_lb ?? 0),
				meta: [item?.row.data.category ?? '', item?.damage ?? '', ac === null ? '' : `AC ${ac}`]
					.filter(Boolean)
					.join(' · '),
				equippable: isEquippable(item),
				consumable: isConsumable(item),
				attunable: needsAttunement(item),
			};
		});
	});

	carriedLb = $derived.by(() =>
		carriedWeight(this.list, (ref) => Number(this.resolve(ref)?.row.data.weight_lb ?? 0)),
	);
	capacityLb = $derived.by(() => this.getSheet()?.carryingCapacity.value ?? 0);
	/** 0…1 for the load meter; 0 when nothing has told us a capacity yet. */
	load = $derived(this.capacityLb > 0 ? Math.min(1, this.carriedLb / this.capacityLb) : 0);
	overCapacity = $derived(this.capacityLb > 0 && this.carriedLb > this.capacityLb);

	attuned = $derived.by(() => attunedCount(this.list));
	attunementFull = $derived(this.attuned >= ATTUNEMENT_CAP);

	private write = (next: InventoryEntry[]) => {
		const c = this.getCharacter();
		if (c) c.build.inventory = next;
	};

	equip = (ref: string) => this.write(toggleEquipped(this.list, ref));

	/**
	 * Attune / un-attune. Un-attuning is always allowed. Attuning a fourth item is blocked in Strict
	 * and allowed in Free, which is the same split the builder's caps use — Charnik is a tool, so the
	 * mode the character was built in decides whether a cap is a wall or a note.
	 */
	attune = (ref: string) => {
		const c = this.getCharacter();
		if (!c) return;
		const entry = c.build.inventory.find((e) => e.item === ref);
		if (!entry) return;
		if (!entry.attuned && this.attunementFull) {
			if (c.ui.strict) {
				toast(`Attuned to ${ATTUNEMENT_CAP} items already`, {
					description: 'Break attunement with one first, or switch this character to Free.',
				});
				return;
			}
			toast(`Over the attunement limit (${ATTUNEMENT_CAP})`, {
				description: 'Free mode — allowed, and the count says so.',
			});
		}
		this.write(toggleAttuned(c.build.inventory, ref));
	};

	bump = (ref: string, by: number) => this.write(bumpQty(this.list, ref, by));

	/** Spend one. The last one leaves the list, so a used-up stack does not linger as a zero row. */
	use = (ref: string) => {
		const c = this.getCharacter();
		if (!c) return;
		const row = this.rows.find((r) => r.entry.item === ref);
		this.write(useOne(c.build.inventory, ref));
		if (row) toast(`Used ${row.name}`, { description: `${row.entry.qty - 1} left` });
	};
}
