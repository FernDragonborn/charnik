<script lang="ts">
	// Languages. A flat multi-select — there is nothing to compare and nothing to preview, so this
	// pane is deliberately just the chips and a count.
	//
	// It still opens with the SAME search row as every other picker and walks with the same keys:
	// thirty-five rows is a list, and a list the keyboard cannot reach is one ui.md §5 does not
	// allow. Enter takes or drops the highlighted language, because here reading and taking are the
	// same act — a language has nothing to read.
	import { _ } from '$lib/i18n';
	import { build, rowName } from '../build-view-model.svelte';
	import { filterByName } from '../rows';
	import { PickerReading } from '../picker-reading.svelte';
	import PickerSearch from './PickerSearch.svelte';
	import OwnEntries from './OwnEntries.svelte';
	const b = build;

	let query = $state('');
	let highlighted = $state<string | null>(null);
	const shown = $derived(filterByName(b.languageList, query));

	const pickerId = $props.id();
	const picker = new PickerReading(
		() => ({
			ids: shown.map((r) => r.effectiveId),
			previewId: highlighted,
			onpreview: (id) => (highlighted = id),
			// there is no article to open here, so Enter goes straight through to the toggle
			onenter: (id) => b.toggleLanguage(id),
		}),
		pickerId,
	);
</script>

<p class="subtext">
	{$_('build.languages.chosen', { values: { count: b.draft.selectedLanguages.length } })}{#if b.backgroundLangCount > 0}
		· {$_('build.languages.backgroundGrants', { values: { count: b.backgroundLangCount } })}{/if}
</p>

<PickerSearch
	bind:query
	bind:element={picker.search}
	placeholder={$_('build.languages.search')}
	count={shown.length}
	onkeydown={picker.fromSearch}
	listId={picker.listId}
	activeId={picker.activeId}
/>

<div
	class="chips"
	id={picker.listId}
	role="listbox"
	aria-multiselectable="true"
	aria-label={$_('build.inspector.options')}
	tabindex="-1"
	onkeydown={picker.fromOptions}
>
	{#each shown as row (row.effectiveId)}
		{@const on = b.draft.selectedLanguages.includes(row.effectiveId)}
		<button
			class="pick-chip"
			id={picker.optionId(row.effectiveId)}
			role="option"
			aria-selected={on}
			class:on
			class:is-active={row.effectiveId === highlighted}
			onclick={() => b.toggleLanguage(row.effectiveId)}>{rowName(row)}</button
		>
	{:else}
		<p class="subtext">{$_('build.inspector.noMatch', { values: { query } })}</p>
	{/each}
</div>

<!-- The pane is where languages are edited, so the TOOLS a player writes for themselves live here
     too: both are the same kind of fact (a proficiency the app prints and never computes), and a
     second pane holding one text field would be a trip for a word. -->
<OwnEntries
	label={$_('build.own.languages')}
	placeholder={$_('build.own.languagesHint')}
	bind:entries={b.draft.customLanguages}
/>
<OwnEntries
	label={$_('build.own.tools')}
	placeholder={$_('build.own.toolsHint')}
	bind:entries={b.draft.customTools}
/>
