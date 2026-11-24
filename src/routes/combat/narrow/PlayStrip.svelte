<script lang="ts">
	// The narrow layouts' one strip (`work/play-layout.md` ▸ NARROW-DESKTOP, PHONE-PLAY): the controls
	// and the turn or the passing of time side by side, sliding sideways when the window is too narrow
	// for both rather than taking a second row.
	import type { Character } from '#lib/character/schema.ts';
	import Controls from '../blocks/Controls.svelte';
	import Turnbar from '../blocks/Turnbar.svelte';
	import TimeSkip from '../blocks/TimeSkip.svelte';

	let { c }: { c: Character } = $props();
</script>

<div class="play-strip">
	<Controls {c} compact />
	{#if c.play.inCombat}<Turnbar {c} />{:else}<TimeSkip />{/if}
</div>

<style>
	.play-strip {
		flex: none;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		overflow-x: auto;
	}
	.play-strip > :global(*) {
		flex: none;
	}
	.play-strip :global(.controls) {
		flex-wrap: nowrap;
		margin-bottom: 0;
	}
	/* one line, as the mock draws it: the controls and the steps side by side, without the bar's own
	   frame and title, which a wide screen needs to tell its bars apart and one strip does not */
	.play-strip :global(.combat-bar) {
		margin-bottom: 0;
		padding: 0;
		background: transparent;
		border: 0;
		min-height: 0;
	}
	.play-strip :global(.bar-label) {
		display: none;
	}
	.play-strip :global(.spacer) {
		display: none;
	}
	/* the mock's pills: words without their glyphs, and less air, so the line fits a third of a screen */
	.play-strip :global(.toggle) {
		gap: var(--space-1);
		padding: var(--space-1) var(--space-2);
	}
	.play-strip :global(.toggle > svg) {
		display: none;
	}
	.play-strip :global(.controls),
	.play-strip :global(.combat-bar) {
		gap: var(--space-1-5);
	}
</style>
