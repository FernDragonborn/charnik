<script lang="ts">
	// The table's log on the Table screen, for both seats: the rolls this app holds, newest first,
	// who each one is from, and who this app's own rolls go to. Every roll is peer text, rendered as
	// text (`docs/internals/table-link.md` ▸ The table's log).
	import { _ } from '$lib/i18n';
	import { app } from '$lib/stores/app.svelte';
	import { AUDIENCE } from '$lib/table-link/types';
	import { TABLE_ROLE, table } from './table-view-model.svelte';
	import type { LogLine } from './table-log.svelte';
	import TableRollResult from './TableRollResult.svelte';

	const lines = $derived(table.log.shown);
	const seat = $derived(table.role === TABLE_ROLE.gm ? 'gm' : 'player');

	/** A player's name is whatever they typed, "GM" included, so the GM is marked as a badge no
	 *  name can draw. */
	const whoRolled = (line: LogLine): string =>
		line.mine ? $_('table.log.you') : (line.name ?? '');
	/** The roll's words in this app's language when its key names a roll; any other key is a peer
	 *  reaching for one of this app's sentences, and its own words are shown instead. */
	const rollName = (line: LogLine): string => {
		const { text, key } = line.record.body.name;
		return key && LOGGED_ROLL_KEY.test(key) ? $_(key, { default: text }) : text;
	};
	const LOGGED_ROLL_KEY = /^(combat\.roll\.(check|save)\.[a-z]+|skillName\.[a-z_]+)$/;
	const byTheGm = (line: LogLine): boolean =>
		!line.mine && line.record.author === line.record.table;
	const timeOf = (at: number): string =>
		new Date(at).toLocaleTimeString(app.activeLocale, { hour: '2-digit', minute: '2-digit' });
</script>

<section class="table-log" aria-labelledby="table-log-title">
	<div class="table-log-head">
		<h2 class="table-section" id="table-log-title">{$_('table.log.title')}</h2>
		<div class="table-log-audience" role="radiogroup" aria-label={$_('table.log.rollsTo')}>
			<span class="eyebrow">{$_('table.log.rollsTo')}</span>
			{#each [AUDIENCE.table, AUDIENCE.gm] as to (to)}
				<button
					type="button"
					class="pill-btn"
					class:accent={table.rollsTo === to}
					role="radio"
					aria-checked={table.rollsTo === to}
					onclick={() => (table.rollsTo = to)}>{$_(`table.log.audience.${seat}.${to}`)}</button
				>
			{/each}
		</div>
	</div>
	{#if lines.length}
		<ul class="table-rows">
			{#each lines as line (`${line.record.author}#${line.record.seq}`)}
				<li class="table-row">
					<span class="muted table-log-time">{timeOf(line.record.at)}</span>
					{#if byTheGm(line)}<span class="durpill">{$_('table.log.gm')}</span>{:else}<b
							class="table-log-who">{whoRolled(line)}</b
						>{/if}
					<span class="table-log-name">{rollName(line)}</span>
					{#if line.record.body.to === AUDIENCE.gm}
						<span class="durpill">{$_('table.log.gmOnly')}</span>
					{/if}
					<span class="table-row-spacer"></span>
					<TableRollResult roll={line.record.body.roll} />
					{#if table.log.canHide(line)}
						<button
							type="button"
							class="btn ghost table-log-hide"
							aria-label={$_('table.log.hideLabel')}
							onclick={() => table.log.hide(line)}>{$_('table.log.hide')}</button
						>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted">{$_('table.log.empty')}</p>
	{/if}
</section>

<style>
	.table-log {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.table-log-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2) var(--space-4);
	}
	.table-log-audience {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1-5);
	}
	.table-log-audience .eyebrow {
		margin: 0;
	}
	.table-log-time {
		font-variant-numeric: tabular-nums;
		font-size: var(--font-size-sm);
	}
	.table-log-who,
	.table-log-name {
		overflow-wrap: anywhere;
	}
</style>
