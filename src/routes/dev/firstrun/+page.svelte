<script lang="ts">
	// DEV-ONLY preview of the first-run "where to store data" modal. Not linked from the app;
	// open /dev/firstrun to see it live. The folder picker is stubbed (returns a fake parent dir)
	// so it previews in a plain browser; the real app injects the Tauri plugin-dialog picker.
	import FirstRunModal from '$lib/components/FirstRunModal.svelte';

	let shown = $state(true);
	let last = $state('');

	// stub: pretend the user browsed to a different parent folder
	const pickFolder = async () => 'D:\\Games\\TTRPG';
</script>

<div class="page">
	<h1>Dev preview · FirstRunModal</h1>
	<p>Last action: <code>{last || '—'}</code></p>
	<button onclick={() => (shown = true)}>Reopen modal</button>
</div>

{#if shown}
	<FirstRunModal
		defaultDir="C:\Users\fern\Documents\charnik"
		{pickFolder}
		onConfirm={(dir) => {
			last = 'confirm ' + dir;
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
