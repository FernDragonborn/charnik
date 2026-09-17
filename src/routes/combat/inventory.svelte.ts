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
import { t, translator } from '$lib/i18n';
import {
	addItem,
	removeItem,
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
import { COINS, costSaid, purseWeightLb, type Purse } from '$lib/rules/currency';
import { say } from '$lib/util/say';
import { needsBaseItem, resolveItem, type ResolvedItem } from '$lib/content/resolved-item';
import { type ContentGraph } from '$lib/content/loader';
import { localizedName } from '$lib/content/detail';
import { app } from '$lib/stores/app.svelte';
import { isRowActive } from '$lib/content/sources.svelte';
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
	/** A template item ("Weapon (Any Melee Weapon)") — one whose own row does not say what kind of
	 *  thing it is. Stays true after a base is picked, because the pick is the player's and they must
	 *  be able to change it: the row keeps the chooser, with `entry.base` selected in it. */
	isTemplate: boolean;
}

/** A mundane item a template can be resolved against, as the picker lists it. */
export interface BaseItemOption {
	ref: string;
	name: string;
}

export class InventoryTracker {
	constructor(
		private getCharacter: () => Character | null,
		private getGraph: () => ContentGraph | null,
		private getSheet: () => CharacterSheet | null,
	) {}

	private resolve = (ref: string, base?: string): ResolvedItem | undefined => {
		const graph = this.getGraph();
		if (!graph) return undefined;
		const row = graph.get(ref);
		return row?.type === 'item' ? resolveItem(graph, row, base) : undefined;
	};

	private get list(): InventoryEntry[] {
		return this.getCharacter()?.build.inventory ?? [];
	}

	rows = $derived.by<InventoryRow[]>(() => {
		const c = this.getCharacter();
		if (!c) return [];
		return c.build.inventory.map((entry) => {
			// resolved TWICE only for a template that has a base: once as the row itself is (is there a
			// question to ask?) and once as the player answered it (what does the sheet show?)
			const bare = this.resolve(entry.item);
			const item = entry.base ? this.resolve(entry.item, entry.base) : bare;
			const ac = item ? tagInt(item.tags, ITEM_TAG.ac) : null;
			return {
				entry,
				// the ref itself is the last resort: a row whose item left the graph must still be
				// visible and removable, never a blank line the user cannot act on
				name: item ? localizedName(item.row, app.activeLocale) : entry.item,
				item,
				weightLb: item?.weightLb ?? 0,
				meta: [
					item?.row.data.category ?? '',
					item?.damage ?? '',
					ac === null ? '' : `AC ${ac}`,
					// what it is worth, for the half of the game that is spending and selling. Magic items
					// carry no price in either SRD, so the cell is simply absent for them rather than zero.
					say(costSaid(item?.row.data.cost), translator()),
				]
					.filter(Boolean)
					.join(' · '),
				equippable: isEquippable(item),
				consumable: isConsumable(item),
				attunable: needsAttunement(item),
				isTemplate: !!bare && needsBaseItem(bare),
			};
		});
	});

	/** The purse, and the coins the sheet shows of it. Hiding electrum is a view choice, so a hidden
	 *  coin keeps whatever is in it — and keeps weighing, if this character weighs coins at all. */
	get purse(): Purse {
		return this.getCharacter()?.play.currency ?? {};
	}
	shownCoins = $derived.by(() => {
		const hidden = new Set(this.getCharacter()?.ui.coinsHidden ?? []);
		return COINS.filter((coin) => !hidden.has(coin.id));
	});
	isCoinShown = (id: string): boolean => !(this.getCharacter()?.ui.coinsHidden ?? []).includes(id);
	/** Show/hide one denomination for this character. */
	toggleCoin = (id: string) => {
		const c = this.getCharacter();
		if (!c) return;
		const hidden = c.ui.coinsHidden;
		c.ui.coinsHidden = hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id];
	};
	setCoin = (id: string, count: number) => {
		const c = this.getCharacter();
		if (!c) return;
		c.play.currency = { ...c.play.currency, [id]: Math.max(0, Math.floor(count)) };
	};
	coinOf = (id: string): number => this.purse[id] ?? 0;

	/** Whether this character's load counts their money (`ui.coinWeight`, off by default). */
	get weighsCoins(): boolean {
		return this.getCharacter()?.ui.coinWeight ?? false;
	}
	toggleCoinWeight = () => {
		const c = this.getCharacter();
		if (c) c.ui.coinWeight = !c.ui.coinWeight;
	};
	/** What the purse adds to the load — zero unless this character weighs coins. */
	coinsLb = $derived(this.weighsCoins ? purseWeightLb(this.purse) : 0);

	carriedLb = $derived(
		// through `resolveItem`, so a magic weapon weighs what the weapon it IS weighs
		carriedWeight(this.list, (ref, base) => this.resolve(ref, base)?.weightLb ?? 0) + this.coinsLb,
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

	/** The shield this character carries, if any. The Combat toolbar's Shield toggle is this row's
	 *  equip button under another name: a shield in HAND is what the AC counts (`deriveAc`), so there
	 *  is one fact here and not a play flag beside it that could disagree. */
	shield = $derived(this.rows.find((r) => r.item?.row.data.category === 'shield'));

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
				toast(t('combat.notice.attunementFull', { cap: ATTUNEMENT_CAP }), {
					description: t('combat.notice.attunementFullBody'),
				});
				return;
			}
			toast(t('combat.notice.overAttunement', { cap: ATTUNEMENT_CAP }), {
				description: t('combat.notice.overAttunementBody'),
			});
		}
		this.write(toggleAttuned(c.build.inventory, ref));
	};

	bump = (ref: string, by: number) => this.write(bumpQty(this.list, ref, by));

	/**
	 * Reorder what the character carries. The inventory ARRAY is the order — nothing new is stored,
	 * and a reorder persists the way every other inventory edit does.
	 *
	 * Refs the caller does not name keep their places at the end rather than being dropped: a list
	 * rebuilt from a drag is the view's idea of the list, and the character's is the one that counts.
	 */
	reorder = (refs: string[]) => {
		const byRef = new Map(this.list.map((entry) => [entry.item, entry]));
		const moved = refs.map((ref) => byRef.get(ref)).filter((e) => e !== undefined);
		const rest = this.list.filter((entry) => !refs.includes(entry.item));
		this.write([...moved, ...rest]);
	};

	/** The same reorder by keyboard — one step up or down, for the people a drag excludes. */
	move = (ref: string, by: -1 | 1) => {
		const order = this.list.map((entry) => entry.item);
		const at = order.indexOf(ref);
		const to = at + by;
		if (at < 0 || to < 0 || to >= order.length) return;
		const swapped = order[to];
		if (swapped === undefined) return;
		order[to] = ref;
		order[at] = swapped;
		this.reorder(order);
	};

	/** Own one more of something, and put one back. Both are BUILD writes made from play: the builder
	 *  still decides what a character owns, and this is the same act reached from where you notice it
	 *  — a looted item mid-session. Quantity beyond the first is `bump`'s job. */
	add = (ref: string) => this.write(addItem(this.list, ref));
	remove = (ref: string) => this.write(removeItem(this.list, ref));

	/** Every mundane item a template could BE, of the same kind as the template asking: a weapon
	 *  template offers weapons, an armour one offers armour. Mundane = no rarity, which is what marks
	 *  an item magical (`content.md`), and a row that states nothing itself is a template too and has
	 *  nothing to lend. Edition- and source-filtered like every other list the sheet shows. */
	baseOptionsFor = (ref: string): BaseItemOption[] => {
		const graph = this.getGraph();
		const c = this.getCharacter();
		const template = graph?.get(ref);
		if (!graph || !c || template?.type !== 'item') return [];
		const out: BaseItemOption[] = [];
		for (const row of graph.rows) {
			if (row.type !== 'item' || !row.systems.includes(c.system) || !isRowActive(row)) continue;
			if (row.data.category !== template.data.category || row.data.rarity) continue;
			// a row that would itself need a base has nothing to lend
			if (needsBaseItem(resolveItem(graph, row))) continue;
			out.push({ ref: `item:${row.source}:${row.id}`, name: localizedName(row, app.activeLocale) });
		}
		return out.sort((a, b) => a.name.localeCompare(b.name));
	};

	/** Say which item a template is — or take the answer back, which leaves the row saying it needs
	 *  one rather than silently keeping the last pick. */
	setBase = (ref: string, base: string) => {
		const entry = this.getCharacter()?.build.inventory.find((e) => e.item === ref);
		if (!entry) return;
		if (base) entry.base = base;
		else delete entry.base;
	};

	/** Spend one. The last one leaves the list, so a used-up stack does not linger as a zero row. */
	use = (ref: string) => {
		const c = this.getCharacter();
		if (!c) return;
		const row = this.rows.find((r) => r.entry.item === ref);
		this.write(useOne(c.build.inventory, ref));
		if (row)
			toast(t('combat.notice.usedItem', { name: row.name }), {
				description: t('combat.notice.itemsLeft', { count: row.entry.qty - 1 }),
			});
	};
}
