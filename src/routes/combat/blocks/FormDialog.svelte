<script lang="ts">
	// Which stat block to assume. The same sectioned picker the builder and the item dialog mount —
	// take on the left, read on the right — grouped by Challenge Rating, which is the one fact about a
	// beast the feature's own limit is written in. Taking a row answers the question; closing the
	// dialog leaves it unanswered, and nothing was spent.
	import { _ } from '$lib/i18n';
	import DialogShell from '$lib/components/DialogShell.svelte';
	import SectionedPicker from '../../build/blocks/SectionedPicker.svelte';
	import { rowDetail, rowName } from '../../build/rows';
	import { challengeRating } from '$lib/character/forms';
	import { combat } from '../combat-view-model.svelte';

	const asking = $derived(combat.forms.asking);
	let query = $state('');
	let previewId = $state<string | null>(null);

	const sections = $derived.by(() => {
		const byRating = new Map<string, NonNullable<typeof asking>['options']>();
		for (const row of asking?.options ?? []) {
			const rating = row.data.cr ?? '';
			byRating.set(rating, [...(byRating.get(rating) ?? []), row]);
		}
		return [...byRating.entries()]
			.sort(([a], [b]) => (challengeRating(a) ?? 0) - (challengeRating(b) ?? 0))
			.map(([rating, rows]) => ({
				key: rating,
				label: $_('combat.forms.rating', { values: { rating: rating || '—' } }),
				rows: rows.sort((a, b) => rowName(a).localeCompare(rowName(b))),
			}));
	});
	const detail = $derived(
		rowDetail(previewId ? combat.graph?.get(previewId) : undefined, 'monster'),
	);
	const worn = $derived(combat.character?.play.form?.monster);
</script>

{#if asking}
	<DialogShell
		titleId="form-dialog-title"
		title={asking.rules.source}
		subtitle={$_(asking.options.length ? 'combat.forms.choose' : 'combat.forms.none')}
		width="760px"
		badge="paw-print"
		onDismiss={() => (combat.forms.asking = null)}
	>
		{#if asking.options.length}
			<div class="picker">
				<SectionedPicker
					{sections}
					bind:query
					{previewId}
					takenIds={worn ? [worn] : []}
					onpreview={(id) => (previewId = id)}
					ontake={(id) => asking.answer(id)}
					{detail}
					placeholder={$_('combat.forms.search')}
				/>
			</div>
		{/if}
	</DialogShell>
{/if}

<style>
	/* the list scrolls itself; the dialog gives it a height to do that inside */
	.picker {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-height: 0;
		max-height: min(62vh, 560px);
	}
</style>
