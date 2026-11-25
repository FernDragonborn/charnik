<script lang="ts">
	import { contextAct } from '#lib/actions/contextAct.ts';
	import { articleHref } from '#lib/combat/row-menu.ts';
	// N1: what the character is carrying, at play time. The builder decides WHAT is owned; this panel
	// is the four things that change mid-session — equip, attune, how many, use one up — plus the load
	// bar. Adding an item shares the builder's search because both acts choose from the same content.
	import Icon from '#lib/components/Icon.svelte';
	import DialogShell from '#lib/components/DialogShell.svelte';
	import { tick } from 'svelte';
	import { resolve } from '$app/paths';
	import { combat } from '../../combat-view-model.svelte';
	import { _ } from '#lib/i18n/index.ts';
	import { ATTUNEMENT_CAP } from '#lib/character/inventory.ts';
	import { kilograms } from '#lib/combat/constants.ts';
	import { why } from '#lib/combat/helpers.ts';
	import { asksWhichOne, type InstanceAnswers } from '#lib/content/item-instance.ts';
	import ItemInstanceAsk from '../../../build/blocks/ItemInstanceAsk.svelte';
	import { rowName } from '../../../build/rows';
	import { askAgain, type InstanceAsk } from '../../../build/item-instance-picking.svelte';
	import { provenance } from '#lib/actions/provenance.ts';
	import AddItemPopover from '../AddItemPopover.svelte';
	import { dndzone } from 'svelte-dnd-action';
	import { removeKeepingFocus } from '#lib/util/remove-keeping-focus.ts';
	import { dragMotion, TOUCH_HOLD_MS, NO_LIBRARY_TAB_STOPS } from '#lib/actions/dragMotion.ts';
	import RowGrip from '../RowGrip.svelte';
	import { INVENTORY_GROUP, inventoryGroupOf, type InventoryRow } from '../../inventory.svelte';
	import { movedOrder, reorderRowSubset } from '#lib/combat/row-order.ts';

	let { furniture = true, phone = false }: { furniture?: boolean; phone?: boolean } = $props();
	const inv = $derived(combat.inventory);
	/** The add dialog is mounted from here rather than from the combat shell: it belongs to this
	 *  panel's one control, and nothing else opens it. */
	let adding = $state(false);
	let addControl = $state<HTMLButtonElement>();

	const rows = $derived(inv.rows);
	// `why` returns the provenance SENTENCE (the action takes a string), '' when there is no sheet yet
	const capacityWhy = $derived(combat.sheet ? why(combat.sheet.carryingCapacity, $_) : '');

	/* What the list looks like MID-DRAG. The character's array is the real order, but writing to it on
	   every `consider` would re-derive the whole sheet for each frame of a drag — so the zone's own
	   list stands in until the drop, and the drop is what the character hears about. */
	type Item = { id: string; row: InventoryRow };
	type Group = (typeof INVENTORY_GROUP)[keyof typeof INVENTORY_GROUP];
	let dragging = $state<{ group: Group | null; items: Item[] } | null>(null);
	/* the item carries its ROW — see `AttacksPanel` for what a lookup by id cost the shadow item */
	const items = $derived(rows.map((row) => ({ id: row.entry.iid, row })));
	const groups = $derived(
		Object.values(INVENTORY_GROUP).map((group) => ({
			group,
			items: items.filter(({ row }) => inventoryGroupOf(row) === group),
		})),
	);
	let itemOpen = $state<string | null>(null);
	const detail = $derived(rows.find((row) => row.entry.iid === itemOpen));
	const buttonId = (id: string) => `phone-inventory-${id}`;
	const findItem = (id: string) => document.getElementById(buttonId(id));

	async function focusItem(id: string): Promise<void> {
		await tick();
		const control = findItem(id);
		const category = control?.closest('details');
		if (category instanceof HTMLDetailsElement) category.open = true;
		(control ?? addControl)?.focus();
	}

	function closeItem(): void {
		if (itemOpen) void focusItem(itemOpen);
		itemOpen = null;
	}

	function finishItem(row: InventoryRow, run: () => boolean): void {
		const button = findItem(row.entry.iid);
		itemOpen = null;
		if (button) void removeKeepingFocus(button, '.inv-row', run, addControl ?? null);
		else run();
	}

	function consume(row: InventoryRow): void {
		const run = () => inv.use(row.entry.iid);
		if (phone && row.entry.qty === 1) finishItem(row, run);
		else run();
	}

	function reorder(order: string[], group: Group | null): void {
		inv.reorder(
			group === null
				? order
				: reorderRowSubset(
						items.map((item) => item.id),
						undefined,
						order,
					),
		);
	}

	function quickToggle(row: InventoryRow, toggle: (id: string) => boolean): void {
		if (toggle(row.entry.iid)) void focusItem(row.entry.iid);
	}

	function rowMenu(row: InventoryRow, event: Event): void {
		combat.menus.openRowMenu(
			{
				title: row.name,
				compendium: row.item ? articleHref(row.item.row.effectiveId) : undefined,
				acts: [
					{
						label: $_('combat.inventory.remove', { values: { name: row.name } }),
						run: () =>
							phone ? finishItem(row, () => inv.remove(row.entry.iid)) : inv.remove(row.entry.iid),
					},
				],
			},
			event,
		);
	}

	/** The question asked again from a carried row, and which row it is for. */
	let reasking = $state<{ ask: InstanceAsk; row: string } | null>(null);
	const reask = (row: InventoryRow, anchor: HTMLElement) => {
		const heading = row.item ? rowName(row.item.row) : row.name;
		reasking = { row: row.entry.iid, ask: askAgain(row.entry, heading, row.questions, anchor) };
	};
	const answerReask = (answers: InstanceAnswers) => {
		const row = reasking?.row;
		reasking = null;
		if (row) inv.reanswer(row, answers);
	};
</script>

<div class="load">
	<span class="eyebrow">{$_('combat.inventory.load')}</span>
	<!-- ui.md rule 3 lists carrying capacity among the values that must explain themselves — and the
	     5e encumbrance tiers live ONLY in this value's notes, so without the popover the two thresholds
	     that change a 2014 character's speed are computed and unreachable -->
	<span class="load-figure" use:provenance={capacityWhy}>
		{$_('combat.inventory.weight', {
			values: { carried: Math.round(inv.carriedLb), capacity: inv.capacityLb },
		})}
		<span class="metric">({kilograms(inv.carriedLb)} / {kilograms(inv.capacityLb)})</span>
	</span>
	<span class="spacer"></span>
	<span class="attune" class:full={inv.attunementFull}>
		{$_('combat.inventory.attuned', {
			values: { count: inv.attuned, cap: ATTUNEMENT_CAP },
		})}
	</span>
</div>
<div class="meter" class:good={!inv.overCapacity} class:over={inv.overCapacity}>
	<span style:width="{inv.load * 100}%"></span>
</div>
{#if inv.overCapacity}
	<p class="note">{$_('combat.inventory.overCapacity')}</p>
{/if}

<!-- The purse. Money is play-state, not an inventory row (`rules/currency.ts` says why), so it sits
     above the items with its own line — and the exchange reference sits with it, because "is 12 sp
     enough" is a question you have while looking at the coins, not one worth a trip elsewhere. -->
<div class="purse">
	{#each inv.shownCoins as coin (coin.id)}
		<label class="coin">
			<span class="coin-name">{$_(`coinName.${coin.id}`)}</span>
			<input
				type="number"
				min="0"
				value={inv.coinOf(coin.id)}
				oninput={(e) => inv.setCoin(coin.id, Number(e.currentTarget.value))}
				aria-label={$_(`coinNameLong.${coin.id}`)}
			/>
		</label>
	{/each}
</div>
<p class="note rates">{$_('combat.inventory.exchange')}</p>

<!-- Adding is a BUILD act done from play, so it is a control here and not only a link away: the
     moment you notice you are carrying something is mid-session, not in the builder. -->
{#if !phone}<div class="items-head">
		<span class="eyebrow">{$_('combat.inventory.items')}</span>
		{@render addButton()}
	</div>{/if}

{#snippet addButton()}
	<button
		class="add-item"
		class:phone-add={phone}
		bind:this={addControl}
		aria-expanded={adding}
		onclick={() => (adding = !adding)}
		use:provenance={$_('combat.inventory.addItem')}
		aria-label={$_('combat.inventory.addItem')}
	>
		<Icon name="plus" size={14} />{#if phone}{$_('combat.inventory.addItem')}{/if}
	</button>
{/snippet}

{#if phone && items.length}
	{#each groups as group (group.group)}
		{#if group.items.length}
			<details class="play-group" open={group.group !== INVENTORY_GROUP.gear}>
				<summary
					>{$_(`combat.inventory.groups.${group.group}`)}
					<span class="group-count">{group.items.length}</span><Icon name="chevron-down" />
				</summary>
				{@render inventoryRows(group.items, group.group)}
			</details>
		{/if}
	{/each}
{:else}
	{@render inventoryRows(items, null)}
{/if}
{#if phone}{@render addButton()}{/if}

<!-- The order of what you carry is the PLAYER's, and it is the array itself — so a drag here needs no
     stored layout of its own, unlike the panels. The other panels are deliberately not draggable: their
     order IS their grouping (skills by ability, spells by level), and a row dragged out of its group
     would be saying something the list does not mean. -->
{#snippet inventoryRows(list: Item[], group: Group | null)}
	{@const visible = dragging?.group === group ? dragging.items : list}
	<div
		class="items"
		use:dragMotion={furniture}
		use:dndzone={{
			dragDisabled: !furniture,
			items: visible,
			type: group === null ? 'inventory-row' : `inventory-row-${group}`,
			// on a finger a drag is TAKEN, not started: hold still and the row becomes yours to move.
			// The wait is shown by `dragMotion`'s ring and must stay its two halves added up.
			delayTouchStart: TOUCH_HOLD_MS,
			flipDurationMs: 150,
			dropTargetStyle: {},
			...NO_LIBRARY_TAB_STOPS,
			morphDisabled: true,
		}}
		onconsider={(e) => (dragging = { group, items: e.detail.items })}
		onfinalize={(e) => {
			dragging = null;
			reorder(
				e.detail.items.map((i) => i.id),
				group,
			);
		}}
	>
		{#each visible as item (item.id)}
			{@const row = item.row}
			{#if row}
				<div
					class="inv-row"
					class:phone-item={phone}
					use:contextAct={{ touch: !furniture, open: (e) => rowMenu(row, e) }}
				>
					{#if furniture}
						<RowGrip
							panel="inventory"
							id={row.entry.iid}
							name={row.name}
							onmove={(by) =>
								group === null
									? inv.move(row.entry.iid, by)
									: reorder(
											movedOrder(
												list.map((item) => item.id),
												row.entry.iid,
												by,
											),
											group,
										)}
						/>
					{/if}
					{#if phone}
						<button
							type="button"
							class="item-line"
							id={buttonId(row.entry.iid)}
							aria-haspopup="dialog"
							onclick={() => (itemOpen = row.entry.iid)}
						>
							<span class="nm">{row.name}</span>
							{#if row.stat}<span class="item-stat">{row.stat}</span>{/if}
							{#if row.consumable || row.entry.qty > 1}<span class="qty-tag">×{row.entry.qty}</span
								>{/if}
						</button>
						{#if row.consumable}
							<button type="button" class="pill-btn item-quick" onclick={() => consume(row)}>
								{$_('combat.inventory.use')}
							</button>
						{:else if row.equippable}
							<button
								type="button"
								class="pill-btn item-quick"
								onclick={() => quickToggle(row, inv.equip)}
							>
								{$_(row.entry.equipped ? 'combat.inventory.unequip' : 'combat.inventory.equip')}
							</button>
						{:else if row.entry.attuned}
							<button
								type="button"
								class="pill-btn item-quick"
								onclick={() => quickToggle(row, inv.attune)}
							>
								{$_('combat.inventory.unattune')}
							</button>
						{/if}
					{:else}
						<!-- a row the book prints once is asked which one it is when it is added; its own name is
				     where that is asked again, holding the answers it has, which is the way back from a
				     misclick (an item answered wrongly used to be a remove and a re-add) -->
						{#if asksWhichOne(row.questions)}
							<button
								type="button"
								class="nm name-button"
								aria-haspopup="dialog"
								use:provenance={$_('combat.inventory.reask', { values: { name: row.name } })}
								onclick={(e) => reask(row, e.currentTarget)}>{row.name}</button
							>
						{:else}
							<span class="nm">{row.name}</span>
						{/if}
						{#if row.entry.qty > 1}<span class="qty-tag">×{row.entry.qty}</span>{/if}
						<span class="meta">{row.meta}</span>
						{#if row.weightLb}<span class="wt"
								>{$_('combat.inventory.pounds', { values: { lb: row.weightLb } })}</span
							>{/if}
						<!-- a row carried from before the question was asked at Add still has it open: it grants
				     nothing until answered, so it says so where it stands -->
						{#if row.unanswered}
							<button
								type="button"
								class="pill-btn"
								aria-haspopup="dialog"
								onclick={(e) => reask(row, e.currentTarget)}
								>{$_('combat.inventory.askWhich')}</button
							>
						{/if}
						{@render itemControls(row)}
						<!-- the way OUT, mirroring the grip on the other edge: one press, no confirm — its toast
				     offers Undo, which puts the row back with its quantity, attunement and answers -->
						<button
							class="row-remove"
							onclick={(e) =>
								void removeKeepingFocus(
									e.currentTarget,
									'.inv-row',
									() => inv.remove(row.entry.iid),
									e.currentTarget.closest('.panel-region')?.querySelector<HTMLElement>('.htoggle'),
								)}
							aria-label={$_('combat.inventory.remove', { values: { name: row.name } })}
							use:provenance={$_('combat.inventory.remove', { values: { name: row.name } })}
							><Icon name="trash-2" size={12} /></button
						>
					{/if}
				</div>
			{/if}
		{:else}
			<p class="note">
				{$_('combat.inventory.empty')}
				<a href={resolve('build')}>{$_('combat.inventory.openBuilder')}</a>
			</p>
		{/each}
	</div>
{/snippet}

{#snippet itemControls(row: InventoryRow)}
	<span class="acts" class:item-controls={phone}>
		{#if phone}<span class="quantity-label">{$_('combat.inventory.quantity')}</span>{/if}
		<span class="stepper">
			<button
				aria-label={$_('combat.inventory.fewer', { values: { name: row.name } })}
				onclick={() => inv.bump(row.entry.iid, -1)}
			>
				<Icon name="minus" size={11} />
			</button>
			<span class="base">{row.entry.qty}</span>
			<button
				aria-label={$_('combat.inventory.more', { values: { name: row.name } })}
				onclick={() => inv.bump(row.entry.iid, 1)}
			>
				<Icon name="plus" size={11} />
			</button>
		</span>
		{#if row.consumable}
			<button class="pill-btn" onclick={() => consume(row)}>{$_('combat.inventory.use')}</button>
		{/if}
		{#if row.equippable}
			<button
				class="pill-btn"
				class:accent={row.entry.equipped}
				onclick={() => inv.equip(row.entry.iid)}
				use:provenance={$_(
					row.entry.equipped ? 'combat.inventory.unequipHint' : 'combat.inventory.equipHint',
				)}
			>
				{$_(
					row.entry.equipped
						? phone
							? 'combat.inventory.unequip'
							: 'combat.inventory.equipped'
						: 'combat.inventory.equip',
				)}
			</button>
		{/if}
		<!-- In a form whose rules say so, what is carried works only where the form WEARS it.
					     Which pieces a wolf can wear is the player's and the GM's to say, so each is
					     asked, and until it is answered the item has merged into the form. -->
		{#if combat.forms.wornOnly && (row.entry.equipped || row.entry.attuned)}
			{@const worn = combat.forms.isWorn(row.entry.iid)}
			<button
				class="pill-btn"
				class:accent={worn}
				aria-pressed={worn}
				onclick={() => combat.forms.setWorn(row.entry.iid, !worn)}
				use:provenance={$_(
					worn ? 'combat.inventory.formWornHint' : 'combat.inventory.formMergedHint',
				)}
			>
				{$_(worn ? 'combat.inventory.formWorn' : 'combat.inventory.formMerged')}
			</button>
		{/if}
		{#if row.attunable}
			<button
				class="pill-btn"
				class:accent={row.entry.attuned}
				onclick={() => inv.attune(row.entry.iid)}
				use:provenance={$_(
					row.entry.attuned ? 'combat.inventory.unattuneHint' : 'combat.inventory.attuneHint',
				)}
			>
				{$_(
					row.entry.attuned
						? phone
							? 'combat.inventory.unattune'
							: 'combat.inventory.attunedOn'
						: 'combat.inventory.attune',
				)}
			</button>
		{/if}
	</span>
{/snippet}

{#if detail}
	{@const itemLink = detail.item ? articleHref(detail.item.row.effectiveId) : undefined}
	{@const hasWeight = detail.weightLb > 0 || detail.item?.row.data.weight_lb != null}
	<DialogShell
		titleId="phone-item-details"
		title={detail.name}
		sub={detail.item
			? $_(`itemCategory.${detail.item.row.data.category}`, {
					default: detail.item.row.data.category,
				})
			: ''}
		width="100%"
		bottom
		onDismiss={closeItem}
	>
		<div class="dialog-body">
			{#if detail.item?.damage}
				<div class="item-reading">
					<span>{$_('combat.inventory.damage')}</span><b>{detail.item.damage}</b>
				</div>
			{/if}
			{#if hasWeight || detail.value}
				<div class="item-reading">
					<span>{$_('combat.inventory.weightValue')}</span>
					<b
						>{#if hasWeight}
							{$_('combat.inventory.pounds', { values: { lb: detail.weightLb } })} ({kilograms(
								detail.weightLb,
							)})
						{/if}{#if detail.value}{hasWeight ? ' · ' : ''}{detail.value}{/if}</b
					>
				</div>
			{/if}
			{@render itemControls(detail)}
			{#if asksWhichOne(detail.questions)}
				<button
					type="button"
					class="pill-btn"
					onclick={(event) => reask(detail, event.currentTarget)}
				>
					{$_('combat.inventory.askWhich')}
				</button>
			{/if}
			{#if itemLink}<a class="pill-btn" href={itemLink}
					><Icon name="book-open" />{$_('combat.rowMenu.compendium')}</a
				>{/if}
			<button
				type="button"
				class="pill-btn item-remove"
				onclick={() => finishItem(detail, () => inv.remove(detail.entry.iid))}
				><Icon name="trash-2" />{$_('combat.inventory.remove', {
					values: { name: detail.name },
				})}</button
			>
		</div>
	</DialogShell>
{/if}

{#if adding && addControl}
	<AddItemPopover anchor={addControl} {phone} onclose={() => (adding = false)} />
{/if}
{#if reasking}
	<ItemInstanceAsk ask={reasking.ask} onanswer={answerReask} oncancel={() => (reasking = null)} />
{/if}

<style>
	/* a header for the list, holding the one control that adds to it */
	.items-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) 0 var(--space-1);
	}
	.items-head .eyebrow {
		flex: 1;
	}
	/* a rounded SQUARE, not a pill: it is a button that opens something, not one of the row's own
	   state toggles, and the shape is what keeps those two readable apart */
	.add-item {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
	}
	.add-item:hover {
		color: var(--color-text);
		border-color: var(--color-border-strong);
	}

	.load {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		margin-bottom: var(--space-1-5);
	}
	.spacer {
		flex: 1;
	}
	.load-figure {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.metric {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
	}
	.attune {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
	.attune.full {
		color: var(--color-resource);
	}
	.meter.over > span {
		background: var(--color-danger);
	}
	.note {
		margin: var(--space-2) 0 0;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		line-height: 1.5;
	}
	.purse {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1-5);
		margin-top: var(--space-2);
	}
	.coin {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: 2px var(--space-1-5);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface-2);
	}
	.coin-name {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.coin input {
		width: 4.5ch;
		border: 0;
		background: transparent;
		color: var(--color-text);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		text-align: end;
		padding: 2px 0;
	}
	.coin input:focus-visible {
		outline: var(--focus-ring);
		outline-offset: 2px;
	}
	.rates {
		margin-top: var(--space-1);
	}

	.items {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-top: var(--space-2-5);
	}
	/* hung just outside the row's END, as the grip hangs outside its start, so it costs the row no
	   width; shown with the row's hover or the keyboard's focus, and quietly present on touch */
	.row-remove {
		position: absolute;
		inset-inline-end: calc(-1 * (var(--row-bleed) + var(--space-4)));
		top: 0;
		bottom: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: var(--space-4);
		padding: 0;
		background: transparent;
		border: 0;
		color: var(--color-text-muted);
		cursor: pointer;
		opacity: 0;
	}
	.inv-row:hover > .row-remove,
	.row-remove:focus-visible {
		opacity: 1;
	}
	.row-remove:hover,
	.row-remove:focus-visible {
		color: var(--color-danger);
	}
	@media (hover: none) {
		.row-remove {
			opacity: 0.4;
		}
	}
	.inv-row {
		/* the handle hangs outside this row, which — unlike a combat row — does not bleed into the
		   card's padding. What it must clear instead is this row's own border: an absolute child is
		   positioned against the PADDING box, which sits inside it. Matched to the border below, and a
		   hairline is a hairline at any root size. */
		position: relative;
		--row-bleed: 1px;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface-2);
	}
	.nm {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
		white-space: nowrap;
	}
	.qty-tag {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-resource);
	}
	.meta {
		flex: 1;
		min-width: 0;
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.wt {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
	.acts {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}
	.stepper button {
		width: 22px;
		height: 22px;
	}
	.stepper .base {
		font-size: var(--font-size-sm);
		min-width: 20px;
	}
	.phone-add {
		inline-size: 100%;
		min-block-size: var(--space-6);
		gap: var(--space-2);
		cursor: pointer;
	}
	.group-count {
		margin-inline-start: auto;
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
	}
	.group-count + :global(svg) {
		margin-inline-start: 0;
	}
	.inv-row.phone-item {
		padding: var(--space-1) 0;
		border: 0;
		background: transparent;
	}
	.item-line {
		display: flex;
		align-items: center;
		flex: 1;
		gap: var(--space-1-5);
		min-inline-size: 0;
		min-block-size: var(--space-6);
		padding-inline: var(--space-1-5);
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--color-text);
		cursor: pointer;
		text-align: start;
	}
	.item-line:hover {
		background: var(--color-surface-2);
	}
	.item-line .nm {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.item-stat {
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
	}
	.item-quick {
		flex: none;
		min-block-size: var(--space-6);
	}
	.item-reading {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
	}
	.item-reading b {
		text-align: end;
	}
	.item-controls {
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.quantity-label {
		margin-inline-end: auto;
	}
	.item-controls .stepper button {
		inline-size: var(--space-6);
		block-size: var(--space-6);
	}
	.item-remove {
		color: var(--color-danger);
	}
</style>
