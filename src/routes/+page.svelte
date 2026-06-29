<script lang="ts">
	// Roster (home). Placeholder until the character store lands (roadmap P7).
	import { _ } from '$lib/i18n';
</script>

<section class="page">
	<p class="eyebrow">{$_('app.tagline')}</p>
	<h1>{$_('nav.roster')}</h1>
	<p class="muted">No characters yet. Character creation arrives in roadmap P8.</p>
</section>

<style>
	.page :global(h1) {
		font-family: var(--font-display);
		font-size: var(--font-size-2xl);
		margin: var(--space-1) 0 var(--space-2);
	}
	.eyebrow {
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		font-size: var(--font-size-xs);
		color: var(--color-accent);
	}
	.muted {
		color: var(--color-text-muted);
	}
</style>
