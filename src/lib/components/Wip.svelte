<script lang="ts">
	// Placeholder for routes/views not built yet. Big honest "WIP" sign so the deployed
	// shell (GitHub Pages / dev) never looks broken — just clearly unfinished.
	let { title = '', note = '' }: { title?: string; note?: string } = $props();
</script>

<section class="wip" aria-label="Work in progress">
	<p class="tag">Work in progress</p>
	<p class="big" aria-hidden="true">WIP</p>
	{#if title}<h1>{title}</h1>{/if}
	<p class="note">{note || 'This part of Charnik is being built.'}</p>
</section>

<style>
	.wip {
		min-height: 60vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		gap: var(--space-2);
	}
	.tag {
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		font-size: var(--font-size-xs);
		color: var(--color-accent);
		margin: 0;
	}
	.big {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: clamp(4rem, 22vw, 12rem);
		line-height: 0.9;
		letter-spacing: -0.04em;
		margin: 0;
		color: var(--color-text);
		/* subtle striped "under construction" fill via the accent token */
		background: repeating-linear-gradient(
			45deg,
			var(--color-text) 0 12px,
			var(--color-accent) 12px 24px
		);
		-webkit-background-clip: text;
		background-clip: text;
		-webkit-text-fill-color: transparent;
		opacity: 0.9;
	}
	h1 {
		font-family: var(--font-display);
		font-size: var(--font-size-xl);
		margin: var(--space-2) 0 0;
	}
	.note {
		color: var(--color-text-muted);
		max-width: 42ch;
		margin: 0;
	}
</style>
