<script lang="ts">
	// Shared empty state for the play views (Combat / Spellbook) when there's no active character —
	// e.g. the user deleted the demo and has no characters of their own. A small notification, not a
	// full page: heading + one line + a primary "Create character" (→ builder) and a quiet "Restore
	// demo" (re-seeds the demo, then lands on Combat). Kept out of the sheet logic — the pages render
	// this INSTEAD of the sheet via their existing top-level guard.
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { _ } from '$lib/i18n';
	import { recreateDemoCharacter } from '$lib/character/store.svelte';

	let busy = $state(false);
	async function restoreDemo() {
		busy = true;
		try {
			await recreateDemoCharacter();
			// HARD navigate (not SPA goto): this empty state can itself be on /combat, and a client-side
			// goto to the same route wouldn't re-run the page's load() → the view would stay on the empty
			// state despite the demo now existing. A full load re-initializes the play view cleanly.
			window.location.assign(`${base}/combat`);
		} finally {
			busy = false;
		}
	}
</script>

<div class="no-character">
	<div class="nc-card">
		<h2 class="nc-title">{$_('noCharacter.title')}</h2>
		<p class="nc-body">{$_('noCharacter.body')}</p>
		<div class="nc-actions">
			<button class="btn primary" onclick={() => goto(`${base}/build`)} disabled={busy}>
				{$_('noCharacter.create')}
			</button>
			<button class="btn ghost" onclick={restoreDemo} disabled={busy}>
				{$_('noCharacter.restoreDemo')}
			</button>
		</div>
	</div>
</div>

<style>
	.no-character {
		display: flex;
		justify-content: center;
		padding: var(--space-6) var(--space-4);
	}
	.nc-card {
		max-width: 440px;
		width: 100%;
		text-align: center;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-6);
	}
	.nc-title {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-h5);
		margin: 0 0 var(--space-2);
		color: var(--color-text);
	}
	.nc-body {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin: 0 0 var(--space-5);
		line-height: 1.5;
	}
	.nc-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		justify-content: center;
	}
</style>
