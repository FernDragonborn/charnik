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
	import { provenance } from '$lib/actions/provenance';
	const b = build;

	let query = $state('');
	let highlighted = $state<string | null>(null);
	const shown = $derived(filterByName(b.languageList, query));

	// what was chosen, and what the background and the class features leave to choose, as one line
	const summary = $derived(
		[
			$_('build.languages.chosen', { values: { count: b.draft.selectedLanguages.length } }),
			b.backgroundLangCount > 0
				? $_('build.languages.backgroundGrants', { values: { count: b.backgroundLangCount } })
				: '',
			b.languagesFromFeatures.choices > 0
				? $_('build.languages.featureGrants', { values: { count: b.languagesFromFeatures.choices } })
				: '',
		]
			.filter(Boolean)
			.join(' · '),
	);

	const pickerId = $props.id();
	const picker = new PickerReading(
		() => ({
			ids: shown.map((r) => r.effectiveId),
			previewId: highlighted,
			onpreview: (id) => (highlighted = id),
			// there is no article to open here, so Enter goes straight through to the toggle
			onenter: (id) => {
				if (!b.languagesFromFeatures.granted.some((g) => g.row.effectiveId === id))
					b.toggleLanguage(id);
			},
		}),
		pickerId,
	);
</script>

<p class="subtext">{summary}</p>

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
		{@const grant = b.languagesFromFeatures.granted.find((g) => g.row.id === row.id)}
		{@const on = !!grant || b.draft.selectedLanguages.includes(row.effectiveId)}
		<!-- a language a class feature teaches is locked on, the way a background's tool is: it is not
		     a pick, and the chip says where it came from -->
		<button
			class="pick-chip"
			id={picker.optionId(row.effectiveId)}
			role="option"
			aria-selected={on}
			aria-disabled={grant ? true : undefined}
			class:on
			class:is-active={row.effectiveId === highlighted}
			use:provenance={grant
				? $_('build.languages.fromFeature', { values: { feature: rowName(grant.from) } })
				: ''}
			onclick={() => {
				if (!grant) b.toggleLanguage(row.effectiveId);
			}}>{rowName(row)}</button
		>
	{:else}
		<p class="subtext">{$_('build.inspector.noMatch', { values: { query } })}</p>
	{/each}
</div>

<!-- Tools sit in the same pane for the same reason: a proficiency you take once and never spend.
     They are CHIPS rather than typed words because a tool has a row — which is where the ability its
     check uses comes from — and the typed list below is still there for a trade no pack ships. -->
<span class="eyebrow">{$_('build.tools.label')}</span>
<div class="chips" role="group" aria-label={$_('build.tools.label')}>
	{#each b.toolList as row (row.effectiveId)}
		{@const fromBackground = b.backgroundTools.includes(row.id)}
		{@const fromFeat = !fromBackground && b.feats.featToolPicks.includes(row.id)}
		{@const granted = fromBackground || fromFeat}
		{@const on = granted || b.draft.selectedTools.includes(row.id)}
		<!-- a background's tool is locked on, the way its skills are: it is not a pick. So is one a
		     feat's choice granted — it is un-picked where it was picked. `aria-disabled` so the chip can
		     still be reached to say so (ui.md ▸ rule 10) -->
		<button
			class="pick-chip"
			aria-pressed={on}
			class:on
			aria-disabled={granted ? true : undefined}
			use:provenance={fromBackground
				? $_('build.tools.fromBackground')
				: fromFeat
					? $_('build.tools.fromFeat')
					: ''}
			onclick={() => b.toggleTool(row.id)}>{rowName(row)}</button
		>
	{:else}
		<p class="subtext">{$_('build.tools.none')}</p>
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
