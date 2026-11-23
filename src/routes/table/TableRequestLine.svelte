<script lang="ts">
	// What a GM's request says, as one line: the same words on the player's prompt and in the GM's
	// own list of what was asked. A request is ids and numbers, so the words are this app's — the
	// roll's name from the catalogs, the state's from the reader's own content.
	import { _ } from '#lib/i18n/index.ts';
	import { app } from '#lib/stores/app.svelte.ts';
	import { content } from '#lib/content/store.svelte.ts';
	import { localizedName } from '#lib/content/detail.ts';
	import { titleCase } from '#lib/util/format.ts';
	import { REQUESTED_ROLL, TABLE_REQUEST, type TableRequest } from '#lib/table-link/types.ts';

	let {
		request,
		heldTo,
		sheetState,
	}: {
		request: TableRequest;
		/** The DC the GM holds a roll to, when it is the GM reading and the request does not say it. */
		heldTo?: number | undefined;
		/** On the player's prompt: the name of the state the open sheet would put on for this id —
		 *  the row of the character's own edition and sources, which is not always the first row of
		 *  that id in the graph. */
		sheetState?: ((id: string) => string | undefined) | undefined;
	} = $props();

	/** A state's name as the sheet would apply it, else in this app's own content; an id it does
	 *  not have reads as itself. */
	const stateName = (id: string): string => {
		const onSheet = sheetState?.(id);
		if (onSheet !== undefined) return onSheet;
		const row = content.graph?.list('effect').find((state) => state.id === id);
		return row ? localizedName(row, app.activeLocale) : titleCase(id);
	};

	const ROLL_NAME_KEY = {
		[REQUESTED_ROLL.abilityCheck]: 'combat.roll.check',
		[REQUESTED_ROLL.savingThrow]: 'combat.roll.save',
		[REQUESTED_ROLL.skill]: 'skillName',
	} as const;

	const dc = $derived(request.kind === TABLE_REQUEST.roll ? (request.dc ?? heldTo) : undefined);
</script>

<span class="table-request-line">
	{#if request.kind === TABLE_REQUEST.damage}
		{$_('table.request.damage', { values: { amount: request.amount } })}
		{#if request.type}
			<span class="durpill"
				>{$_(`damageType.${request.type}`, { default: titleCase(request.type) })}</span
			>
		{/if}
	{:else if request.kind === TABLE_REQUEST.heal}
		{$_('table.request.heal', { values: { amount: request.amount } })}
	{:else if request.kind === TABLE_REQUEST.effect}
		{$_('table.request.effect', { values: { state: stateName(request.id) } })}
	{:else}
		{$_('table.request.roll', {
			values: {
				roll: $_(`${ROLL_NAME_KEY[request.roll]}.${request.id}`, {
					default: titleCase(request.id),
				}),
			},
		})}
		{#if dc !== undefined}
			<span class="durpill">{$_('table.request.dc', { values: { dc } })}</span>
		{/if}
	{/if}
</span>

<style>
	.table-request-line {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1-5);
	}
</style>
