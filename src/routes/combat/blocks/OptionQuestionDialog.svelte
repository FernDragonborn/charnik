<script lang="ts">
	// A question an option asks before anything is paid, answered with a number: which spell slot
	// pays for it (a druid's Wild Resurgence), or how many uses a cost of X spends (Nature
	// Magician). Taking a row answers; closing the dialog leaves it unanswered with nothing spent.
	import { _ } from '$lib/i18n';
	import DialogShell from '$lib/components/DialogShell.svelte';
	import { combat } from '../combat-view-model.svelte';

	const asking = $derived(combat.executor.asking);
</script>

{#if asking}
	<DialogShell
		titleId="option-question-title"
		title={asking.name}
		subtitle={$_(`combat.menu.optionQuestion.${asking.kind}`)}
		width="360px"
		badge="flame-kindling"
		onDismiss={() => (combat.executor.asking = null)}
	>
		<div class="answers">
			{#each asking.values as value (value)}
				<button class="combat-row" onclick={() => asking.answer(value)}>
					<span class="row-name"
						>{$_(`combat.menu.optionAnswer.${asking.kind}`, { values: { value } })}</span
					>
				</button>
			{/each}
		</div>
	</DialogShell>
{/if}

<style>
	/* the shell's body has no padding of its own: a picker fills it edge to edge, a list of rows
	   stands in from it */
	.answers {
		padding: var(--space-2) var(--space-4) var(--space-4);
	}
</style>
