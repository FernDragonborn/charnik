<script lang="ts">
	// N1: what the character is carrying, at play time. The builder decides WHAT is owned; this panel
	// is the four things that change mid-session — equip, attune, how many, use one up — plus the load
	// bar, which is the only place carrying capacity has ever been shown (it was computed and never
	// rendered). Adding an item is still the builder's equipment pane: that is a search through
	// hundreds of rows, not a play action.
	import Icon from '$lib/components/Icon.svelte';
	import { base } from '$app/paths';
	import { combat } from '../../combat-view-model.svelte';
	import { _ } from '$lib/i18n';
	import { ATTUNEMENT_CAP } from '$lib/character/inventory';
	import { kilograms } from '$lib/combat/constants';
	import { why } from '$lib/combat/helpers';
	import { damageTypeLabel } from '$lib/combat/attacks';
	import { provenance } from '$lib/actions/provenance';
	import AddItemPopover from '../AddItemPopover.svelte';
	import { dndzone } from 'svelte-dnd-action';
	import { dragMotion, TOUCH_HOLD_MS } from '$lib/actions/dragMotion';
	import RowGrip from '../RowGrip.svelte';
	import type { InventoryRow } from '../../inventory.svelte';

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
	let dragging = $state<{ id: string; row: InventoryRow }[] | null>(null);
	/* the item carries its ROW — see `AttacksPanel` for what a lookup by id cost the shadow item */
	const items = $derived(dragging ?? rows.map((row) => ({ id: row.entry.iid, row })));
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
<div class="items-head">
	<span class="eyebrow">{$_('combat.inventory.items')}</span>
	<button
		class="add-item"
		bind:this={addControl}
		aria-expanded={adding}
		onclick={() => (adding = !adding)}
		title={$_('combat.inventory.addItem')}
		aria-label={$_('combat.inventory.addItem')}
	>
		<Icon name="plus" size={14} />
	</button>
</div>

<!-- The order of what you carry is the PLAYER's, and it is the array itself — so a drag here needs no
     stored layout of its own, unlike the panels. The other panels are deliberately not draggable: their
     order IS their grouping (skills by ability, spells by level), and a row dragged out of its group
     would be saying something the list does not mean. -->
<div
	class="items"
	use:dragMotion
	use:dndzone={{
		items,
		type: 'inventory-row',
		// on a finger a drag is TAKEN, not started: hold still and the row becomes yours to move.
		// The wait is shown by `dragMotion`'s ring and must stay its two halves added up.
		delayTouchStart: TOUCH_HOLD_MS,
		flipDurationMs: 150,
		dropTargetStyle: {},
		morphDisabled: true,
	}}
	onconsider={(e) => (dragging = e.detail.items)}
	onfinalize={(e) => {
		dragging = null;
		inv.reorder(e.detail.items.map((i) => i.id));
	}}
>
	{#each items as item (item.id)}
		{@const row = item.row}
		{#if row}
			<div
				class="inv-row"
				class:asks-base={(row.isTemplate && !row.entry.base) ||
					(row.bonusRungs.length && row.entry.bonus === undefined) ||
					row.choiceOptions.length ||
					row.varieties.length}
			>
				<RowGrip
					panel="inventory"
					id={row.entry.iid}
					name={row.name}
					onmove={(by) => inv.move(row.entry.iid, by)}
				/>
				<span class="nm">{row.name}</span>
				{#if row.entry.qty > 1}<span class="qty-tag">×{row.entry.qty}</span>{/if}
				<span class="meta">{row.meta}</span>
				{#if row.weightLb}<span class="wt"
						>{$_('combat.inventory.pounds', { values: { lb: row.weightLb } })}</span
					>{/if}
				<!-- A template item ("any Simple or Martial weapon") is not a content gap to report — it is a
			     question only the player can answer, so it is asked here, where the item is. -->
				<!-- The same argument as the base above, one step in: the SRD prints ONE "Weapon, +1, +2,
				     or +3", and which one you found is yours to say. Unanswered it grants nothing. -->
				<!-- asked when the item was added; a row carried from before then is asked here, once -->
				{#if row.bonusRungs.length && row.entry.bonus === undefined}
					<label class="base-pick">
						<span class="visually-hidden"
							>{$_('combat.inventory.bonusPick', { values: { name: row.name } })}</span
						>
						<select
							value={row.entry.bonus ?? ''}
							onchange={(e) =>
								inv.setBonus(
									row.entry.iid,
									e.currentTarget.value ? Number(e.currentTarget.value) : undefined,
								)}
						>
							<option value="">{$_('combat.inventory.bonusNone')}</option>
							{#each row.bonusRungs as rung (rung.bonus)}
								<option value={rung.bonus}
									>{rung.rarity
										? $_('combat.inventory.bonusWithRarity', {
												values: {
													bonus: rung.bonus,
													rarity: $_(`itemRarity.${rung.rarity}`, { default: rung.rarity }),
												},
											})
										: $_('combat.inventory.bonusPlain', { values: { bonus: rung.bonus } })}</option
								>
							{/each}
						</select>
					</label>
				{/if}
				<!-- The same question with a word for an answer: the SRD's ring names ONE gemstone and
				     lets the one you found say which. Unanswered it grants nothing. -->
				{#if row.choiceOptions.length}
					<label class="base-pick">
						<span class="visually-hidden"
							>{$_('combat.inventory.choicePick', { values: { name: row.name } })}</span
						>
						<select
							value={row.entry.choice ?? ''}
							onchange={(e) => inv.setChoice(row.entry.iid, e.currentTarget.value)}
						>
							<option value="">{$_('combat.inventory.choiceNone')}</option>
							{#each row.choiceOptions as option (option)}
								<option value={option}>{damageTypeLabel(option, $_)}</option>
							{/each}
						</select>
					</label>
				{/if}
				<!-- And with a ROW for an answer: the book prints one Belt of Giant Strength and five exist,
				     each with a score and a rarity of its own. Unanswered it grants nothing. -->
				{#if row.varieties.length}
					<label class="base-pick">
						<span class="visually-hidden"
							>{$_('combat.inventory.varietyPick', { values: { name: row.name } })}</span
						>
						<select
							value={row.entry.choice ?? ''}
							onchange={(e) => inv.setChoice(row.entry.iid, e.currentTarget.value)}
						>
							<option value="">{$_('combat.inventory.varietyNone')}</option>
							{#each row.varieties as variety (variety.id)}
								<option value={variety.id}
									>{variety.rarity
										? $_('combat.inventory.varietyWithRarity', {
												values: {
													name: variety.name,
													rarity: $_(`itemRarity.${variety.rarity}`, { default: variety.rarity }),
												},
											})
										: variety.name}</option
								>
							{/each}
						</select>
					</label>
				{/if}
				{#if row.isTemplate && !row.entry.base}
					<label class="base-pick">
						<span class="visually-hidden"
							>{$_('combat.inventory.baseItem', { values: { name: row.name } })}</span
						>
						<select
							value={row.entry.base ?? ''}
							onchange={(e) => inv.setBase(row.entry.iid, e.currentTarget.value)}
						>
							<option value="">{$_('combat.inventory.baseItemNone')}</option>
							{#each inv.baseOptionsFor(row.entry.item) as opt (opt.ref)}
								<option value={opt.ref}>{opt.name}</option>
							{/each}
						</select>
					</label>
				{/if}
				<span class="acts">
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
						<button class="pill-btn" onclick={() => inv.use(row.entry.iid)}
							>{$_('combat.inventory.use')}</button
						>
					{/if}
					{#if row.equippable}
						<button
							class="pill-btn"
							class:accent={row.entry.equipped}
							onclick={() => inv.equip(row.entry.iid)}
							title={$_(
								row.entry.equipped ? 'combat.inventory.unequipHint' : 'combat.inventory.equipHint',
							)}
						>
							{$_(row.entry.equipped ? 'combat.inventory.equipped' : 'combat.inventory.equip')}
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
							title={$_(worn ? 'combat.inventory.formWornHint' : 'combat.inventory.formMergedHint')}
						>
							{$_(worn ? 'combat.inventory.formWorn' : 'combat.inventory.formMerged')}
						</button>
					{/if}
					{#if row.attunable}
						<button
							class="pill-btn"
							class:accent={row.entry.attuned}
							onclick={() => inv.attune(row.entry.iid)}
							title={$_(
								row.entry.attuned ? 'combat.inventory.unattuneHint' : 'combat.inventory.attuneHint',
							)}
						>
							{$_(row.entry.attuned ? 'combat.inventory.attunedOn' : 'combat.inventory.attune')}
						</button>
					{/if}
				</span>
				<!-- the way OUT, mirroring the grip on the other edge: one press, no confirm — it is one
				     press to add the item back from the same panel -->
				<button
					class="row-remove"
					onclick={() => inv.remove(row.entry.iid)}
					aria-label={$_('combat.inventory.remove', { values: { name: row.name } })}
					title={$_('combat.inventory.remove', { values: { name: row.name } })}
					><Icon name="trash-2" size={12} /></button
				>
			</div>
		{/if}
	{:else}
		<p class="note">
			{$_('combat.inventory.empty')}
			<a href="{base}/build">{$_('combat.inventory.openBuilder')}</a>
		</p>
	{/each}
</div>

{#if adding && addControl}
	<AddItemPopover anchor={addControl} onclose={() => (adding = false)} />
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

	/* the chooser gets its OWN line: it is a sentence-long question in a row of one-word controls, and
	   squeezing it in beside them collapses the item's kind line to an ellipsis. Only the few rows
	   that ASK wrap — every other row keeps the single-line shape it has always had. */
	.asks-base {
		flex-wrap: wrap;
	}
	.base-pick {
		flex-basis: 100%;
	}
	.base-pick select {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		background: var(--color-surface-2);
		border: 1px dashed var(--color-border-strong);
		border-radius: var(--radius-sm);
		padding: 1px var(--space-1);
		max-inline-size: 220px;
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
</style>
