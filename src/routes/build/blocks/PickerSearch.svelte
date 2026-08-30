<script lang="ts">
	// The search row every builder picker opens with: an icon, the query, and how many options are
	// left. One component rather than one per picker — the grid and the sectioned list ask the same
	// question of the same lists, and two copies of a search box drift.
	import Icon from '$lib/components/Icon.svelte';

	let {
		query = $bindable(''),
		placeholder,
		count,
		onkeydown,
	}: {
		query?: string;
		placeholder: string;
		count: number;
		/** The option walk (↑/↓/Enter) — driven from here, because this is where the caret is. */
		onkeydown: (event: KeyboardEvent) => void;
	} = $props();
</script>

<div class="lsearch">
	<span class="search-icon"><Icon name="search" size={13} /></span>
	<input {placeholder} bind:value={query} {onkeydown} />
	<span class="count">{count}</span>
</div>

<style>
	.lsearch {
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius);
		padding: 0 11px;
		flex: none;
	}
	.lsearch input {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: 0;
		color: var(--color-text);
		font-family: var(--font-body);
		font-size: var(--font-size-sm);
		padding: 8px 0;
	}
	.lsearch input:focus {
		outline: none;
	}
	.lsearch:focus-within {
		border-color: var(--color-accent);
	}
	.search-icon {
		color: var(--color-text-muted);
		display: grid;
		place-items: center;
	}
	.count {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
</style>
