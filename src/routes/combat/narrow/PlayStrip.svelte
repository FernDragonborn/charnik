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
	<Controls {c} />
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
	.play-strip :global(.combat-bar) {
		margin-bottom: 0;
	}
</style>
