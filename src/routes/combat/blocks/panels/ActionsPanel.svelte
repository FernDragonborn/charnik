<script lang="ts">
	// Actions panel body: one ordered list of everything the character can DO on a turn — standard
	// actions (Show/hide-filtered), feature-granted rollables (Sneak Attack, Bardic Inspiration…) and
	// resource spend-options (Ki → Flurry) with a cost chip. Three kinds, one order the player owns.
	import Icon from '#lib/components/Icon.svelte';
	import { provenance } from '#lib/actions/provenance.ts';
	import { contextAct } from '#lib/actions/contextAct.ts';
	import { rowGrid } from '#lib/actions/rowGrid.ts';
	import DialogShell from '#lib/components/DialogShell.svelte';
	import { _ } from '#lib/i18n/index.ts';
	import { app } from '#lib/stores/app.svelte.ts';
	import { combat } from '../../combat-view-model.svelte';
	import { dndzone } from 'svelte-dnd-action';
	import { dragMotion, TOUCH_HOLD_MS, NO_LIBRARY_TAB_STOPS } from '#lib/actions/dragMotion.ts';
	import RowGrip from '../RowGrip.svelte';
	import AttacksPanel from './AttacksPanel.svelte';
	import { movedOrder, orderRows, reorderRowSubset, ROW_PANEL } from '#lib/combat/row-order.ts';
	import { why, type StandardAction } from '#lib/combat/helpers.ts';
	import { ACTION_DEFAULT, ATTACK_ACTION_ID } from '#lib/combat/actions.ts';
	import { ROLL_SWING, type RollSwing, type RowMenuSpec } from '#lib/combat/row-menu.ts';
	import { ACTION_TYPE_SLOT, OPTION_SPENDS_SLOT } from '#lib/play/options.ts';
	/** The three things this panel lists. A player sees one list of things they can do, so they order
	 *  one list: a spend-option that opens the character's whole turn has as much claim to the top as
	 *  Dash does. The kind rides on the row because each renders differently, not because each sorts
	 *  differently. */
	let { furniture = true, phone = false }: { furniture?: boolean; phone?: boolean } = $props();
	const ROW_KIND = { action: 'action', roll: 'roll', spend: 'spend' } as const;
	const GROUP = { action: 'action', bonus: 'bonus', reaction: 'reaction', other: 'other' } as const;
	const PHONE_GROUPS = [
		{ id: GROUP.action, label: 'combat.turn.action' },
		{ id: GROUP.bonus, label: 'combat.actions.bonus' },
		{ id: GROUP.reaction, label: 'combat.turn.reaction' },
		{ id: GROUP.other, label: 'combat.actions.other' },
	] as const;
	type PhoneGroup = (typeof PHONE_GROUPS)[number]['id'];
	const STANDARD_SHEET_ORDER = [
		'dash',
		'disengage',
		'dodge',
		'help',
		'ready',
		'utilize',
		'hide',
		'search',
		'study',
		'grapple',
		'shove',
	];
	const EXAMPLE_ACTION_IDS: readonly string[] = ['dash', 'dodge', 'hide'];
	type FeatureRoll = (typeof combat.featureRolls)[number];
	type SpendOption = (typeof combat.resourceOptions)[number];
	type ActionRow =
		| { kind: typeof ROW_KIND.action; id: string; a: StandardAction }
		| { kind: typeof ROW_KIND.roll; id: string; r: FeatureRoll }
		| { kind: typeof ROW_KIND.spend; id: string; o: SpendOption };

	/* A standard action keeps its bare id, so an order saved before the other two joined it still
	   applies; the newcomers carry their kind, since nothing guarantees a resource option and an
	   action do not share a name. */
	const rows = $derived(
		combat.layout.ordered(
			ROW_PANEL.actions,
			[
				...combat.visibleActions
					.filter((a) => a.byDefault === ACTION_DEFAULT.shown)
					.map((a): ActionRow => ({ kind: ROW_KIND.action, id: a.id, a })),
				...combat.featureRolls.map((r): ActionRow => ({
					kind: ROW_KIND.roll,
					id: `roll:${r.id}:${r.source}`,
					r,
				})),
				...combat.resourceOptions.map((o): ActionRow => ({
					kind: ROW_KIND.spend,
					id: `spend:${o.id}`,
					o,
				})),
				// a row the character starts without goes after everything the character actually has
				...combat.visibleActions
					.filter((a) => a.byDefault === ACTION_DEFAULT.hidden)
					.map((a): ActionRow => ({ kind: ROW_KIND.action, id: a.id, a })),
			],
			(row) => row.id,
		),
	);
	let dragging = $state<{ group: PhoneGroup | null; items: ActionRow[] } | null>(null);
	const phoneGroups = $derived(
		PHONE_GROUPS.map((group) => ({
			...group,
			rows: rows.filter((row) =>
				row.kind === ROW_KIND.spend
					? (ACTION_TYPE_SLOT[row.o.actionType] ?? GROUP.other) === group.id
					: row.kind === ROW_KIND.roll && group.id === GROUP.other,
			),
		})),
	);
	const standardActions = $derived(
		orderRows(
			rows.flatMap((row) =>
				row.kind === ROW_KIND.action && row.id !== ATTACK_ACTION_ID ? [row.a] : [],
			),
			(action) => action.id,
			combat.layout.rowOrder(ROW_PANEL.actions) ?? STANDARD_SHEET_ORDER,
		),
	);
	const standardSummary = $derived.by(() => {
		const examples = [
			...standardActions.filter((action) => EXAMPLE_ACTION_IDS.includes(action.id)),
			...standardActions.filter((action) => !EXAMPLE_ACTION_IDS.includes(action.id)),
		].slice(0, EXAMPLE_ACTION_IDS.length);
		const names = examples.map((action) => $_(action.nameKey));
		const count = standardActions.length - names.length;
		const list = new Intl.ListFormat(app.activeLocale, { type: count ? 'unit' : 'conjunction' });
		return count
			? $_('combat.actions.standardMore', { values: { names: list.format(names), count } })
			: list.format(names);
	});
	let standardOpen = $state(false);
	const closeStandard = () => (standardOpen = false);
	const chooseStandard = (action: StandardAction, swing: RollSwing = ROLL_SWING.straight) => {
		combat.actionClick(action, swing);
		closeStandard();
	};
	const nameOf = (row: ActionRow) =>
		row.kind === ROW_KIND.action
			? $_(row.a.nameKey)
			: row.kind === ROW_KIND.roll
				? row.r.label
				: row.o.name;

	function actionMenu(row: ActionRow, event: Event, inStandardSheet = false): void {
		const title = nameOf(row);
		const use = $_('combat.rowMenu.useAction');
		let spec: RowMenuSpec;
		switch (row.kind) {
			case ROW_KIND.action: {
				const { a } = row;
				const check = a.skill ? combat.sheet?.skills[a.skill] : undefined;
				const perform = (input: Event | RollSwing) => {
					if (inStandardSheet) chooseStandard(a, typeof input === 'number' ? input : undefined);
					else combat.actionClick(a, input);
				};
				spec = {
					title,
					why: [$_(a.descKey), check ? why(check, $_) : ''].filter(Boolean).join('\n'),
					...(a.roll
						? { roll: perform }
						: a.id !== ATTACK_ACTION_ID
							? { acts: [{ label: use, run: perform }] }
							: {}),
				};
				break;
			}
			case ROW_KIND.roll:
				spec = {
					title,
					why: [row.r.formula, row.r.source].join('\n'),
					acts: [{ label: $_('combat.rowMenu.roll'), run: () => combat.rollFeature(row.r) }],
				};
				break;
			case ROW_KIND.spend:
				spec = {
					title,
					acts: [{ label: use, run: () => combat.activateResourceOption(row.o) }],
				};
				break;
		}
		combat.menus.openRowMenu(spec, event);
	}

	function applyOrder(order: string[], group: PhoneGroup | null): void {
		if (group === null) {
			combat.layout.setRowOrder(ROW_PANEL.actions, order);
			return;
		}
		// The phone only moves rows within a category. Keep the other categories' positions and
		// any saved ids from rows that the visibility filter leaves out.
		const saved = combat.layout.rowOrder(ROW_PANEL.actions);
		combat.layout.setRowOrder(
			ROW_PANEL.actions,
			reorderRowSubset(
				rows.map((row) => row.id),
				saved,
				order,
			),
		);
	}
</script>

{#if phone}
	{#each phoneGroups as group (group.id)}
		{#if group.id !== GROUP.other || group.rows.length}
			{@const label = $_(group.label)}
			{@const slot = group.id === GROUP.other ? null : group.id}
			{@const character = combat.character}
			{@const spent =
				slot !== null &&
				character?.play.inCombat &&
				character.play.turn[slot] >= combat.economy.slotMax[slot]}
			<details open class="play-group">
				<summary
					use:provenance={spent
						? $_('combat.actions.spentGroup', { values: { label } })
						: undefined}
				>
					{#if slot}<span class="turn-pip pip-{slot}" class:used={spent} aria-hidden="true"
						></span>{/if}
					{label}<Icon name="chevron-down" />
				</summary>
				{#if group.id === GROUP.action}
					<AttacksPanel {furniture} />
					{#if standardActions.length}
						<button
							type="button"
							class="combat-row standard-actions"
							aria-haspopup="dialog"
							aria-expanded={standardOpen}
							onclick={() => (standardOpen = true)}
						>
							<span class="row-name">{$_('combat.actions.standard')}</span>
							<Icon name="chevron-right" />
							<span class="combat-row-desc">{standardSummary}</span>
						</button>
					{/if}
				{:else if !group.rows.length}
					<p class="empty-action-group">{$_('combat.actions.emptyGroup')}</p>
				{/if}
				{@render actionRows(group.rows, group.id)}
			</details>
		{/if}
	{/each}
	{#if standardOpen}
		<DialogShell
			titleId="phone-standard-actions"
			title={$_('combat.actions.standard')}
			subtitle={$_('combat.actions.standardPrompt')}
			width="100%"
			bottom
			onDismiss={closeStandard}
		>
			<div
				class="dialog-body standard-list"
				role="group"
				aria-labelledby="phone-standard-actions"
				use:rowGrid={'.standard-action-pick'}
			>
				{#each standardActions as action (action.id)}
					<button
						class="combat-row standard-action-pick"
						type="button"
						use:contextAct={{
							touch: true,
							open: (event) =>
								actionMenu({ kind: ROW_KIND.action, id: action.id, a: action }, event, true),
						}}
						onclick={() => chooseStandard(action)}
					>
						<span class="row-name">{$_(action.nameKey)}</span>
						<span class="combat-row-desc">{$_(action.descKey)}</span>
						{#if action.hint}
							{@const check = action.skill ? combat.sheet?.skills[action.skill] : undefined}
							<span class="combat-row-hint" use:provenance={check ? why(check, $_) : undefined}
								>{action.hint}</span
							>
						{/if}
					</button>
				{/each}
			</div>
		</DialogShell>
	{/if}
{:else}
	{@render actionRows(rows, null)}
{/if}

{#snippet actionRows(list: ActionRow[], group: PhoneGroup | null)}
	{@const items = dragging?.group === group ? dragging.items : list}
	<div
		class="dnd-rows"
		use:dragMotion={furniture}
		use:dndzone={{
			dragDisabled: !furniture,
			items,
			type: group === null ? 'action-row' : `action-row-${group}`,
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
			applyOrder(
				e.detail.items.map((i) => i.id),
				group,
			);
		}}
	>
		{#each items as row (row.id)}
			<div class="row-wrap" use:contextAct={{ open: (e) => actionMenu(row, e), touch: !furniture }}>
				{#if furniture}
					<RowGrip
						panel={ROW_PANEL.actions}
						id={row.id}
						name={nameOf(row)}
						onmove={(by) =>
							applyOrder(
								movedOrder(
									list.map((x) => x.id),
									row.id,
									by,
								),
								group,
							)}
					/>
				{/if}
				{#if row.kind === ROW_KIND.action}
					{@const a = row.a}
					<button class="combat-row" onclick={(e) => combat.actionClick(a, e)}>
						<span class="row-name">{$_(a.nameKey)}</span><span class="combat-row-hint"
							>{a.hint || '—'}</span
						>
						<span class="combat-row-desc">{$_(a.descKey)}</span><span class="combat-row-marker"
							>{$_(a.markerKey)}</span
						>
					</button>
					<!-- EFX-ROLL: feature-granted rollables (Sneak Attack Nd6, Bardic Inspiration die). The expr
				     is already resolved to a formula in derive; tap opens the dice tray via the seam. -->
				{:else if row.kind === ROW_KIND.roll}
					{@const r = row.r}
					{@const used = combat.economy.isRollUsed(r.id)}
					<div class="combat-row feature-roll" class:is-blocked={used}>
						<button class="roll-part" onclick={() => combat.rollFeature(r)}>
							<span class="row-name">{r.label}</span><span class="combat-row-hint">{r.formula}</span
							>
							<span class="combat-row-desc">{r.source}</span>
						</button>
						<!-- "used this turn" sets itself only for a roll whose row SAYS it is once per turn (Sneak
					     Attack), where the roll lands; for every other it is the player's mark, and it is theirs
					     to lift either way. Shown only while a turn is being tracked, because that is what
					     clears it. -->
						{#if combat.character?.play.inCombat}
							<button
								class="used-mark"
								class:on={used}
								aria-pressed={used}
								use:provenance={$_('combat.panel.usedThisTurn')}
								onclick={() => combat.economy.toggleRollUsed(r.id)}
							>
								{$_('combat.panel.usedThisTurn')}
							</button>
						{:else}
							<span class="combat-row-marker"
								>{$_('combat.panel.roll')} <Icon name="chevron-right" size={11} /></span
							>
						{/if}
					</div>
					<!-- a resource spend-option (Ki → Flurry of Blows…) with a cost chip; blocked when the pool
				     cannot pay. Tap = afford-check + spend + surface the action. -->
				{:else}
					{@const o = row.o}
					{@const broke = o.cost !== 'x' && o.left < o.cost}
					{@const blocked = !o.available || broke}
					<!-- blocked with `aria-disabled`, never `disabled`: the row's whole job when it can't be used
				     is to say WHY, and a disabled control takes neither hover nor focus, so its reason is
				     unreadable (ui.md ▸ rule 10). The click still lands — the executor refuses it with the
				     same sentence. -->
					<button
						class="combat-row"
						class:is-blocked={blocked}
						aria-disabled={blocked}
						use:provenance={!o.available
							? $_('combat.actions.unavailable')
							: broke
								? $_('combat.actions.cantAfford', { values: { resource: o.resourceName } })
								: // the row's own prose, which is Markdown like every other content text
									{ markdown: o.description }}
						onclick={() => combat.activateResourceOption(o)}
					>
						<span class="row-name">{o.name}</span>
						<span class="combat-row-hint">
							{#if o.cost === 'x' || o.cost > 0}
								<span class="cost-chip">{`${o.cost === 'x' ? 'X' : o.cost} ${o.resourceName}`}</span
								>
							{:else if o.action.split(';').includes(OPTION_SPENDS_SLOT)}
								<span class="cost-chip">{$_('combat.actions.costSlot')}</span>
							{/if}
						</span>
						<span class="combat-row-desc">{o.description}</span>
						<!-- a closed vocabulary reads from the catalog; `bonus_action` is not the word every
					     language uses, and it is not even the word English uses on the rest of this sheet -->
						<span class="combat-row-marker">{$_(`combat.actionType.${o.actionType}`)}</span>
					</button>
				{/if}
			</div>
		{/each}
	</div>
{/snippet}

<style>
	.standard-actions {
		width: 100%;
		cursor: pointer;
	}
	.standard-actions :global(svg) {
		grid-column: 2;
		grid-row: 1 / span 2;
		align-self: center;
	}
	.standard-actions:dir(rtl) :global(svg) {
		scale: -1 1;
	}
	.standard-action-pick {
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr) auto;
		align-items: center;
		width: 100%;
		min-block-size: var(--space-6);
		cursor: pointer;
	}
	.standard-list {
		gap: 0;
	}
	.empty-action-group {
		margin: var(--space-1) 0;
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}
</style>
