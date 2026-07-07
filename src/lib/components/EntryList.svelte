<script lang="ts" generics="T">
	// Left-pane list (d-spellmgr design): search + optional filter chips + grouped rows.
	// Each row shows a name + meta sub-line; `leading`/`trailing` snippets add per-row controls
	// (Spellbook: eye/pin + prepare toggle). Compendium passes none → a plain browsable list.
	import type { Snippet } from 'svelte';
	import type { Entry } from '$lib/content/detail';

	let {
		groups,
		selectedId = null,
		onselect,
		searchValue = $bindable(''),
		searchPlaceholder = 'Search…',
		showEdition = false,
		filters,
		leading,
		trailing
	}: {
		groups: { label: string; entries: Entry<T>[] }[];
		selectedId?: string | null;
		onselect: (e: Entry<T>) => void;
		searchValue?: string;
		searchPlaceholder?: string;
		showEdition?: boolean;
		filters?: Snippet;
		leading?: Snippet<[Entry<T>]>;
		trailing?: Snippet<[Entry<T>]>;
	} = $props();
</script>

<div class="list">
	<div class="lsearch">
		<span class="search-icon">🔍</span><input
			placeholder={searchPlaceholder}
			bind:value={searchValue}
		/>
	</div>
	{#if filters}<div class="lfilter">{@render filters()}</div>{/if}
	<div class="rows">
		{#each groups as g (g.label)}
			{#if g.label}<div class="section"><span>{g.label}</span></div>{/if}
			{#each g.entries as e (e.id)}
				<div
					class="entry-row"
					class:selected={e.id === selectedId}
					role="button"
					tabindex="-1"
					onclick={() => onselect(e)}
					onkeydown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && onselect(e)}
				>
					{#if leading}<span class="acts">{@render leading(e)}</span>{/if}
					<span class="entry-name"
						><b>{e.name}</b>{#if e.meta}<small>{e.meta}</small>{/if}</span
					>
					{#if showEdition && e.edition}<span class="edition-tag">{e.edition}</span>{/if}
					{#if trailing}{@render trailing(e)}{/if}
				</div>
			{:else}
				<div class="section"><span>No matches.</span></div>
			{/each}
		{/each}
	</div>
</div>

<style>
	.list {
		border-right: 1px solid var(--color-border);
		background: var(--color-surface);
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.lsearch {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 12px 13px;
		border-bottom: 1px solid var(--color-border);
		font-size: 13px;
	}
	.lsearch input {
		all: unset;
		flex: 1;
		color: var(--color-text);
	}
	.lsearch .search-icon {
		color: var(--color-text-muted);
	}
	.lfilter {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 9px 13px;
		border-bottom: 1px solid var(--color-border);
	}
	.rows {
		overflow: auto;
		flex: 1;
	}
	.section {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		padding: 10px 13px 4px;
		display: flex;
		justify-content: space-between;
	}
	.entry-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 13px;
		border-top: 1px solid var(--color-border);
		cursor: pointer;
	}
	.entry-row:hover {
		background: var(--color-surface-2);
	}
	.entry-row.selected {
		background: var(--color-surface-2);
		box-shadow: inset 3px 0 0 var(--color-accent);
	}
	.acts {
		display: flex;
		gap: 4px;
		flex: none;
	}
	.edition-tag {
		flex: none;
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
		opacity: 0.7;
		white-space: nowrap;
	}
	.entry-name {
		flex: 1;
		min-width: 0;
	}
	.entry-name b {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 13px;
	}
	.entry-name small {
		display: block;
		color: var(--color-text-muted);
		font-size: 11px;
		font-family: var(--font-mono);
	}
</style>
