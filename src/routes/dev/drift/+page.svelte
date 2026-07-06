<script lang="ts">
	// DEV-ONLY preview of the hash-drift pop-up (DATA-VER-1). Open /dev/drift to see it live.
	// Remove once the drift detection is wired into the real load flow.
	import HashDriftModal from '$lib/components/HashDriftModal.svelte';
	import type { DriftItem } from '$lib/content/meta';

	const items: DriftItem[] = [
		{ file: 'spells_homebrew.csv', declaredDate: '2026-06-20', changedAt: '2026-07-06' },
		{ file: 'monsters_homebrew.csv', declaredDate: '2026-05-01', changedAt: '2026-07-05' },
		{ file: 'items_homebrew.csv', changedAt: '2026-07-06' } // no declared date in header yet
	];

	let shown = $state(true);
	let last = $state('');
</script>

<div class="page">
	<h1>Dev preview · HashDriftModal</h1>
	<p>Last action: <code>{last || '—'}</code></p>
	<button onclick={() => (shown = true)}>Reopen modal</button>
</div>

{#if shown}
	<HashDriftModal
		{items}
		onUpdate={(files) => {
			last = 'update ' + JSON.stringify(files);
			shown = false;
		}}
		onSkip={() => {
			last = 'skip';
			shown = false;
		}}
		onNeverAsk={() => {
			last = 'neverAsk';
			shown = false;
		}}
	/>
{/if}

<style>
	.page {
		padding: var(--space-6);
	}
	h1 {
		font-family: var(--font-display);
		color: var(--color-text);
	}
	p,
	code {
		color: var(--color-text-muted);
	}
	button {
		margin-top: var(--space-3);
		padding: var(--space-2) var(--space-4);
		background: var(--color-accent-deep);
		color: var(--color-accent-text);
		border: 0;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
</style>
