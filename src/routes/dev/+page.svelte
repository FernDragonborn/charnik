<script lang="ts">
	// Dev toolbox index (dev-server only — gated by the /dev layout). Small maintenance actions that
	// don't belong in the shipped UI. Links to the design-preview pages live here too.
	import { toast } from 'svelte-sonner';
	import { recreateDemoCharacter } from '$lib/character/store.svelte';

	let busy = $state(false);
	async function recreateDemo() {
		busy = true;
		try {
			const demo = await recreateDemoCharacter();
			toast(`Demo character reset — ${demo.build.name}`);
		} finally {
			busy = false;
		}
	}
</script>

<div class="page">
	<h1>Dev toolbox</h1>

	<section>
		<h2>Character</h2>
		<button class="action" onclick={recreateDemo} disabled={busy}>♻ Recreate demo character</button>
		<p class="hint">
			Overwrites the persisted demo save with a fresh build and makes it active — wipes accumulated
			demo edits (hidden spells, HP, layout).
		</p>
	</section>

	<section>
		<h2>Design previews</h2>
		<ul>
			<li><a href="meta">Content-metadata modal</a></li>
			<li><a href="drift">Hash-drift review</a></li>
			<li><a href="firstrun">First-run flow</a></li>
			<li><a href="deathsaves">Death saves</a></li>
			<li><a href="plugins">Plugins</a></li>
			<li><a href="storage">Storage</a></li>
		</ul>
	</section>
</div>

<style>
	.page {
		max-width: 640px;
		margin: 0 auto;
		padding: var(--space-4);
	}
	h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-2xl);
		margin: 0 0 20px;
	}
	h2 {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin: 24px 0 10px;
	}
	.action {
		font-family: var(--font-body);
		font-size: var(--font-size-sm);
		color: var(--color-text);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border-strong);
		border-radius: 8px;
		padding: 9px 14px;
		cursor: pointer;
	}
	.action:hover {
		border-color: var(--color-accent);
	}
	.action:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.hint {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin: 8px 0 0;
	}
	ul {
		margin: 0;
		padding-left: 20px;
	}
	li {
		margin: 4px 0;
	}
	a {
		color: var(--color-accent);
	}
</style>
