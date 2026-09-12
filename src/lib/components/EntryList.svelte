<script lang="ts" generics="T">
	// Left-pane list (d-spellmgr design): search + optional filter chips + grouped rows.
	// Each row shows a name + meta sub-line; `leading`/`trailing` snippets add per-row controls
	// (Spellbook: eye/pin + prepare toggle). Compendium passes none → a plain browsable list.
	import Icon from './Icon.svelte';
	import { _ } from '$lib/i18n';
	import { walkOptions, optionDomId } from '$lib/util/option-walk';
	import type { Snippet } from 'svelte';
	import type { Entry } from '$lib/content/detail';

	let {
		groups,
		selectedId = null,
		onselect,
		searchValue = $bindable(''),
		searchPlaceholder,
		showEdition = false,
		filters,
		leading,
		trailing,
	}: {
		groups: { label: string; entries: Entry<T>[] }[];
		selectedId?: string | null;
		onselect: (e: Entry<T>) => void;
		searchValue?: string;
		/** Defaults to the shared “Search…” — a list names what it searches where that helps. */
		searchPlaceholder?: string;
		showEdition?: boolean;
		filters?: Snippet;
		leading?: Snippet<[Entry<T>]>;
		trailing?: Snippet<[Entry<T>]>;
	} = $props();

	/*
	 * The list is operated from the SEARCH BOX (ui.md §5, and the command palette's own shape): the
	 * caret stays where the typing is, ↑/↓ move a highlight the input names through
	 * `aria-activedescendant`, and Enter does what a left click on the highlighted row does. The rows
	 * are not tab stops — a roving one over five hundred of them is a worse answer than the combobox
	 * contract, and the per-row controls a Spellbook row carries stay tabbable on their own.
	 */
	const uid = $props.id();
	const listId = `${uid}-rows`;
	const ids = $derived(groups.flatMap((g) => g.entries.map((e) => e.id)));
	let highlightId = $state<string | null>(null);
	/** The highlight, as long as the current search still shows it — narrowing the list must not leave
	 *  the input naming a row that is no longer there. */
	const activeId = $derived(highlightId && ids.includes(highlightId) ? highlightId : null);
	const rowId = (id: string) => optionDomId(uid, id);
	const entryOf = (id: string) => groups.flatMap((g) => g.entries).find((e) => e.id === id);

	function onSearchKeydown(event: KeyboardEvent): void {
		walkOptions(event, {
			ids,
			previewId: activeId,
			// Home and End stay with the caret, the same call the builder's search box makes
			jumpKeys: false,
			onpreview: (id) => {
				highlightId = id;
				document.getElementById(rowId(id))?.scrollIntoView({ block: 'nearest' });
			},
			onenter: (id) => {
				const entry = entryOf(id);
				if (entry) onselect(entry);
			},
		});
	}
</script>

<div class="list">
	<div class="lsearch">
		<span class="search-icon"><Icon name="search" size={13} /></span><input
			placeholder={searchPlaceholder ?? $_('app.search')}
			bind:value={searchValue}
			role="combobox"
			aria-expanded="true"
			aria-controls={listId}
			aria-activedescendant={activeId ? rowId(activeId) : undefined}
			onkeydown={onSearchKeydown}
		/>
	</div>
	{#if filters}<div class="lfilter">{@render filters()}</div>{/if}
	<div class="rows" id={listId} role="listbox">
		{#each groups as g (g.label)}
			{#if g.label}<div class="section eyebrow" role="presentation">
					<span>{g.label}</span>
				</div>{/if}
			{#each g.entries as e (e.id)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					class="entry-row"
					class:selected={e.id === selectedId}
					class:highlighted={e.id === activeId}
					id={rowId(e.id)}
					role="option"
					tabindex="-1"
					aria-selected={e.id === selectedId}
					onclick={() => onselect(e)}
				>
					{#if leading}<span class="acts">{@render leading(e)}</span>{/if}
					<span class="entry-name"
						><b>{e.name}</b>{#if e.meta}<small>{e.meta}</small>{/if}</span
					>
					{#if showEdition && e.edition}<span class="edition-tag">{e.edition}</span>{/if}
					{#if trailing}{@render trailing(e)}{/if}
				</div>
			{:else}
				<div class="section eyebrow" role="presentation"><span>{$_('app.noMatches')}</span></div>
			{/each}
		{/each}
	</div>
</div>

<style>
	.list {
		border-inline-end: 1px solid var(--color-border);
		background: var(--color-surface);
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.lsearch {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-3);
		border-bottom: 1px solid var(--color-border);
		font-size: var(--font-size-sm);
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
		gap: var(--space-1-5);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--color-border);
	}
	.rows {
		overflow: auto;
		flex: 1;
	}
	.section {
		font-size: var(--font-size-micro);
		padding: var(--space-2-5) var(--space-3) var(--space-1);
		display: flex;
		justify-content: space-between;
	}
	.entry-row {
		display: flex;
		align-items: center;
		gap: var(--space-2-5);
		padding: var(--space-2) var(--space-3);
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
	/* where the keyboard is, which is not the same fact as which row is open — a walk moves the
	   highlight without selecting anything, so the two must not wear one look */
	.entry-row.highlighted {
		background: var(--color-surface-2);
		outline: 1px solid var(--color-border-strong);
		outline-offset: -1px;
	}
	.acts {
		display: flex;
		gap: var(--space-1);
		flex: none;
	}
	.edition-tag {
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
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
		font-size: var(--font-size-sm);
	}
	.entry-name small {
		display: block;
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
		font-family: var(--font-mono);
	}
</style>
