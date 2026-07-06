<script lang="ts">
	// DEV-ONLY preview of the content-metadata review modal (DATA-VER-1). Not linked from the app;
	// open /dev/meta to see it live. Drives the modal with issues derived the same way the loader
	// will — from underfilled CSV headers. Remove once the modal is wired into the real load flow.
	import ContentMetaModal from '$lib/components/ContentMetaModal.svelte';
	import { parseContentDirectives, checkFileMeta } from '$lib/content/meta';

	// mix: a fully-underfilled file (everything empty) + a partially-filled one (license missing, but
	// source/url/systems already declared → those fields should render PRE-FILLED)
	const files: Record<string, string> = {
		'spells_homebrew.csv':
			'id,name_en,text_en,level,school\ntest_bolt,Test Bolt,A bolt.,1,evocation\n',
		'monsters_homebrew.csv':
			'#content-source: My Bestiary\n#content-url: https://example.test/bestiary\n#content-systems: 5.5e\n#content-author: Fern\nid,name_en,cr\ntest_slime,Test Slime,1\n'
	};
	const issues = Object.entries(files)
		.map(([file, csv]) => checkFileMeta(file, parseContentDirectives(csv).directives))
		.filter((i) => i !== null);

	let shown = $state(true);
	let last = $state('');
</script>

<div class="page">
	<h1>Dev preview · ContentMetaModal</h1>
	<p>Last action: <code>{last || '—'}</code></p>
	<button onclick={() => (shown = true)}>Reopen modal</button>
</div>

{#if shown}
	<ContentMetaModal
		{issues}
		onFillAndSave={(fills) => {
			last = 'fillAndSave ' + JSON.stringify(fills);
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
