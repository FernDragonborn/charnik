/*
 * The inventory subsystem of the Combat view-model: what the character is carrying mid-session, and
 * the four things play does to it — equip, attune, change how many, use one up. Split out of
 * CombatVM the way the resource tracker and the turn economy are; CombatVM composes it as
 * `combat.inventory`, passing getters for the reactive character / graph / sheet.
 *
 * The list semantics live in `$lib/character/inventory` (shared with the builder), and what each
 * press DOES is a pure action in `$lib/play/inventory`. What is here is the reactive projection the
 * panel renders, and firing a shot — which stack it spends, asked when there are several.
 */
import { toast } from 'svelte-sonner';
import { t, translator } from '$lib/i18n';
import {
	ATTUNEMENT_CAP,
	attunedCount,
	carriedWeight,
	isConsumable,
	isEquippable,
	needsAttunement,
	type InventoryEntry,
} from '$lib/character/inventory';
import {
	attune,
	changeQuantity,
	disownItem,
	dropItem,
	ownItem,
	reorderInventory,
	setCoin,
	setItemBase,
	setItemBonus,
	setItemChoice,
	toggleEquip,
	useItem,
} from '$lib/play/inventory';
import type { PlayContext, PlayOutcome } from '$lib/play/outcome';
import { COINS, costSaid, purseWeightLb, type Purse } from '$lib/rules/currency';
import { say } from '$lib/util/say';
import { needsBaseItem, resolveItem, type ResolvedItem } from '$lib/content/resolved-item';
import { type ContentGraph } from '$lib/content/loader';
import { localizedName } from '$lib/content/detail';
import { app } from '$lib/stores/app.svelte';
import { isRowActive } from '$lib/content/sources.svelte';
import { tagInt, ITEM_TAG, parseBonusChoices, type BonusRung } from '$lib/content/item-tags';
import { splitList } from '$lib/content/schemas';
import { ammunitionStacks, firedAmmunition } from '$lib/character/ammunition';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import type { MenuKind } from '$lib/combat/helpers';

/** The anchored menu a shot asks "which stack" through. */
export interface InventoryMenus {
	/** Under the trigger that asked, or centred when nothing on screen did (`null`). */
	open(kind: MenuKind, e: Event | null): void;
	close(): void;
}

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
	/** The rungs a `+1/+2/+3` row offers, empty for every row that offers none. Like `isTemplate`,
	 *  it stays offered after an answer: which one you found is yours to correct. */
	bonusRungs: BonusRung[];
	/** The answers a row ASKS for — Ring of Resistance's damage type. Empty for every row that asks
	 *  nothing, and still offered after an answer for the same reason the rungs are. */
	choiceOptions: string[];
}

/** A mundane item a template can be resolved against, as the picker lists it. */
export interface BaseItemOption {
	ref: string;
	name: string;
}

/** What the inventory needs from the sheet around it. */
export interface InventoryHost {
	character: Character | null;
	graph: ContentGraph | null;
	sheet: CharacterSheet | null;
	/** Carry out a play-state action on the open character; false when it was refused. */
	act(action: (character: Character, ctx: PlayContext) => PlayOutcome): boolean;
}

export class InventoryTracker {
	constructor(
		private host: () => InventoryHost,
		private menus: InventoryMenus,
	) {}
	private getCharacter = () => this.host().character;
	private getGraph = () => this.host().graph;
	private getSheet = () => this.host().sheet;
	private act: InventoryHost['act'] = (action) => this.host().act(action);

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
				bonusRungs: parseBonusChoices(item?.row.data.bonus_choice),
				choiceOptions: splitList(item?.row.data.choice_options),
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
	setCoin = (coin: string, count: number) => this.act((c) => setCoin(c, { coin, count }));
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

	/** The shield this character carries, if any. The Combat toolbar's Shield toggle is this row's
	 *  equip button under another name: a shield in HAND is what the AC counts (`deriveAc`), so there
	 *  is one fact here and not a play flag beside it that could disagree. */
	shield = $derived(this.rows.find((r) => r.item?.row.data.category === 'shield'));

	equip = (row: string) => this.act((c, ctx) => toggleEquip(c, { row }, ctx));

	/** Attune / un-attune. Un-attuning is always allowed; a fourth item is blocked in Strict and
	 *  allowed with a note in Free (`$lib/play/inventory` ▸ `attune`). */
	attune = (row: string) => this.act((c, ctx) => attune(c, { row }, ctx));

	bump = (row: string, by: number) => this.act((c, ctx) => changeQuantity(c, { row, by }, ctx));

	/** Reorder what the character carries. The inventory ARRAY is the order — nothing new is stored,
	 *  and a reorder persists the way every other inventory edit does. */
	reorder = (rows: string[]) => this.act((c, ctx) => reorderInventory(c, { rows }, ctx));

	/** The same reorder by keyboard — one step up or down, for the people a drag excludes. */
	move = (row: string, by: -1 | 1) => {
		const order = this.list.map((entry) => entry.iid);
		const at = order.indexOf(row);
		const to = at + by;
		if (at < 0 || to < 0 || to >= order.length) return;
		const swapped = order[to];
		if (swapped === undefined) return;
		order[to] = row;
		order[at] = swapped;
		this.reorder(order);
	};

	/** Own one more of something, and put one back. Both are BUILD writes made from play: the builder
	 *  still decides what a character owns, and this is the same act reached from where you notice it
	 *  — a looted item mid-session. Quantity beyond the first is `bump`'s job. */
	add = (item: string) => this.act((c, ctx) => ownItem(c, { item }, ctx));
	/** Stop carrying an item altogether — what the picker's second press on a taken row means. */
	putBack = (item: string) => this.act((c, ctx) => disownItem(c, { item }, ctx));
	remove = (row: string) => this.act((c, ctx) => dropItem(c, { row }, ctx));

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

	/** Answer "which +N is this one" for a carried item — or un-answer it, which takes the bonus back
	 *  off every number it was folding into. */
	setBonus = (row: string, bonus: number | undefined) =>
		this.act((c, ctx) => setItemBonus(c, { row, ...(bonus === undefined ? {} : { bonus }) }, ctx));

	/** Answer "which type is this one" for a carried item — the ring's gemstone. */
	setChoice = (row: string, choice: string) =>
		this.act((c, ctx) => setItemChoice(c, { row, choice }, ctx));

	/** Say which item a template is — or take the answer back, which leaves the row saying it needs
	 *  one rather than silently keeping the last pick. */
	setBase = (row: string, base: string) => this.act((c, ctx) => setItemBase(c, { row, base }, ctx));

	/** FINESSE-ABILITY: which ability a finesse weapon is swung with, the fifth play-time verb on
	 *  something carried. Keyed by the weapon KIND, so a +1 Rapier and a plain one answer together —
	 *  they are one weapon as far as the choice goes. RAW offers this every swing; storing it per kind
	 *  is the tracker remembering what you keep saying, not deciding for you. */
	setFinesseAbility = (kindId: string, ability: 'str' | 'dex') => {
		const build = this.getCharacter()?.build;
		if (build) build.finesseAbility[kindId] = ability;
	};

	/** Spend one — or `count`, never more than the stack holds. */
	use = (row: string, count = 1) => this.act((c, ctx) => useItem(c, { row, count }, ctx));
	/** Whether a shot spends what it fires (`ui.trackAmmunition`, off by default). */
	get tracksAmmunition(): boolean {
		return this.getCharacter()?.ui.trackAmmunition ?? false;
	}
	toggleAmmunitionTracking = () => {
		const c = this.getCharacter();
		if (c) c.ui.trackAmmunition = !c.ui.trackAmmunition;
	};

	/** The carried stacks the weapon behind an attack can fire, or undefined when it fires none. */
	ammunitionFor = (weaponId: string): InventoryRow[] | undefined => {
		const weapon = this.rows.find((r) => r.item?.row.id === weaponId)?.item;
		const fired = weapon ? firedAmmunition(weapon.tags) : undefined;
		if (!fired) return undefined;
		const carried = this.rows.flatMap((r) =>
			r.item
				? [{ row: r, category: String(r.item.row.data.category ?? ''), tags: r.item.tags }]
				: [],
		);
		return ammunitionStacks(fired, carried).map((s) => s.row);
	};

	/** A shot waiting on "which stack": the shot itself, and how many it fires. */
	shotPending = $state<{ stacks: InventoryRow[]; fire: () => boolean; shots: number } | null>(null);

	/**
	 * Fire, and spend what was fired — only once the shot actually happened, so an attack the turn
	 * could not pay for costs no arrow. With tracking off, or a weapon that fires nothing, this is just
	 * the shot. One stack is the one; several ask first; none says so and fires anyway — the tracker
	 * keeps the count, it does not take the bow out of the player's hands.
	 *
	 * `shots` is how many one press fires — an action that makes several attacks is one press. `e` is
	 * the trigger the "which stack" menu hangs under, or null when no control on screen fired it.
	 */
	shoot = (weaponId: string, e: Event | null, fire: () => boolean, shots = 1) => {
		const stacks = this.tracksAmmunition ? this.ammunitionFor(weaponId) : undefined;
		if (!stacks) {
			fire();
			return;
		}
		if (stacks.length > 1) {
			this.shotPending = { stacks, fire, shots };
			this.menus.open('ammo', e);
			return;
		}
		const only = stacks[0];
		if (!fire()) return;
		if (only) this.use(only.entry.iid, shots);
		else toast(t('combat.notice.noAmmunition'));
	};

	/** Finish the waiting shot from the stack the player picked. */
	shootFrom = (row: string) => {
		const pending = this.shotPending;
		if (!pending) return;
		this.shotPending = null;
		this.menus.close();
		if (pending.fire()) this.use(row, pending.shots);
	};
}
