<script lang="ts">
	// The search row every builder picker opens with: an icon, the query, and how many options are
	// left. One component rather than one per picker — the grid and the sectioned list ask the same
	// question of the same lists, and two copies of a search box drift.
	//
	// It is a SEARCHBOX naming its picker's highlight through `aria-activedescendant`: the caret never
	// leaves this box, so that is the only way a screen reader hears the arrows do anything. Not a
	// combobox — APG's is single-select with selection following focus, and these pickers are
	// multi-select walks that deliberately commit nothing (`option-walk.ts`). The command palette IS
	// a combobox, and says why it differs: `docs/internals/ui.md` ▸ the picker contract.
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';

	let {
		query = $bindable(''),
		placeholder,
		count,
		onkeydown,
		element = $bindable(null),
		listId,
		activeId,
	}: {
		query?: string;
		placeholder: string;
		count: number;
		/** The option walk (↑/↓/Enter) — driven from here, because this is where the caret is. */
		onkeydown: (event: KeyboardEvent) => void;
		/** The input itself, so a walk started on an option can hand the caret back here. */
		element?: HTMLInputElement | null;
		/** The list this box drives, and the option currently highlighted in it. */
		listId: string;
		activeId?: string | undefined;
	} = $props();

	const inputId = $props.id();

	// Opening a picker puts the caret HERE. The whole contract is built on it — `option-walk.ts`:
	// "the walk happens from the search box", and with focus that never moves the box's
	// `aria-activedescendant` is the only thing a screen reader has to go on — but nothing moved focus
	// in, and the pane is the last column in the DOM: 89 Tab stops from the card that opened it.
	$effect(() => {
		element?.focus();
	});
</script>

<div class="lsearch">
	<span class="search-icon"><Icon name="search" size={13} /></span>
	<!-- A placeholder is not a name: it is gone the moment anything is typed, and this box owes one at
	     all times. The house pattern is the visually-hidden label. -->
	<label class="visually-hidden" for={inputId}>{$_('build.picker.searchLabel')}</label>
	<input
		id={inputId}
		bind:this={element}
		{placeholder}
		bind:value={query}
		{onkeydown}
		role="searchbox"
		aria-controls={listId}
		aria-activedescendant={activeId}
		autocomplete="off"
	/>
	<span class="count">{count}</span>
</div>

<style>
	.lsearch {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius);
		padding: 0 var(--space-2-5);
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
		padding: var(--space-2) 0;
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
</style>
