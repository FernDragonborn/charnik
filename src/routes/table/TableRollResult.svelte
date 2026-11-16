<script lang="ts">
	// What a roll at the table came to: the total, the d20 that counted and the modifier — or the
	// outcome a condition forced. One reading for what was asked and what was logged.
	import { _ } from '$lib/i18n';
	import { signed } from '$lib/combat/helpers';
	import type { TableRoll } from '$lib/table-link/wire-schema';

	let { roll }: { roll: TableRoll } = $props();
</script>

<span class="table-row-roll">
	{#if roll.outcome}
		{$_(`table.asked.forced.${roll.outcome}`)}
	{:else}
		<b>{roll.total}</b>
		{#if roll.natural !== undefined}
			<span class="muted"
				>{$_('table.asked.natural', { values: { natural: roll.natural } })}
				{signed(roll.mod)}</span
			>
		{/if}
	{/if}
</span>
