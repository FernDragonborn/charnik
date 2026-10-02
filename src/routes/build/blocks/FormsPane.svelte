<script lang="ts">
	// Known forms: the stat blocks this character has learned for a form they assume (2024 Wild
	// Shape). Chips, like every other capped grant in the builder — the cap and the eligible stat
	// blocks come from the feature's own rules, and at the cap a click replaces the oldest pick.
	// Each chip carries the stat block's Challenge Rating, the one number the rule limits it by, and
	// says the body it would give on hover and on focus.
	import { _ } from '$lib/i18n';
	import { build, rowName } from '../build-view-model.svelte';
	import { provenance } from '$lib/actions/provenance';
	import type { MonsterRow } from '$lib/character/forms';
	const b = build;

	const choices = $derived(b.formPicks.choices);

	/** The body a stat block gives, in the numbers a player compares forms by. */
	const bodyOf = (row: MonsterRow): string =>
		$_('build.forms.body', {
			values: { ac: row.data.ac ?? '—', hp: row.data.hp ?? '—', speed: row.data.speed ?? '—' },
		});
</script>

{#if !choices.length}
	<p class="subtext">{$_('build.forms.none')}</p>
{:else}
	{#each choices as choice (choice.rules.id)}
		<div class="counts">
			<span class={['tag', choice.picks.length < choice.cap && 'accent']}>
				{choice.rules.source}
				{choice.picks.length}/{choice.cap}
			</span>
		</div>
		<p class="subtext">{$_('build.forms.hint')}</p>
		<div class="chips">
			{#each choice.options as row (row.effectiveId)}
				<button
					class="pick-chip"
					class:on={choice.picks.includes(row.effectiveId)}
					use:provenance={bodyOf(row)}
					onclick={() => b.formPicks.toggle(choice, row.effectiveId)}
				>
					{rowName(row)}<span class="rating gold"
						>{$_('build.forms.rating', { values: { rating: row.data.cr ?? '—' } })}</span
					>
				</button>
			{/each}
		</div>
	{/each}
{/if}

<style>
	/* the rating sits beside the name; the gap is the separator, as on the mastery chips */
	.rating {
		margin-inline-start: var(--space-1-5);
	}
	.counts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1-5);
	}
</style>
