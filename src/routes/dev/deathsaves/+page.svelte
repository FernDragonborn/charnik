<script lang="ts">
	// DEV-ONLY view of the hit-point block at 0 hit points. That face is normally reached only by
	// dropping a real character mid-combat, so this route loads the combat view-model as the combat
	// page does, takes the demo character to 0 hit points, and renders the live `HpPanel`: the roll
	// really rolls, the saves press, and the pencil picks the motion.
	// Not linked from the app; gated to dev builds by /dev/+layout.
	import { onMount } from 'svelte';
	import { combat } from '../../combat/combat-view-model.svelte';
	import HpPanel from '../../combat/blocks/HpPanel/HpPanel.svelte';

	const c = $derived(combat.character);
	const s = $derived(combat.sheet);

	onMount(async () => {
		await combat.load();
		if (combat.character) combat.character.play.hp.current = 0;
	});
</script>

<div class="page">
	<h1>Dev preview · the hit-point block at 0 hit points</h1>
	<p>
		<b>Death save</b> rolls a real d20 (picking up <code>save.death</code>, <code>saves</code> and
		<code>d20_tests</code> effects) and applies what RAW says of it. A wing or a skull is also
		pressed by hand; the third of either ends it on <b>Stabilized</b> or <b>Dead</b>, and the arrow
		in that face's corner takes the last save back. The pencil beside the block picks the motion.
	</p>

	{#if c && s}
		<div class="frame">
			<HpPanel {c} {s} />
		</div>
	{:else}
		<p class="loading">Loading the demo character…</p>
	{/if}
</div>

<style>
	.page {
		padding: var(--space-6);
		max-width: 520px;
	}
	h1 {
		font-family: var(--font-display);
		color: var(--color-text);
		font-size: var(--font-size-lg);
	}
	p {
		color: var(--color-text-muted);
		line-height: 1.5;
	}
	code {
		font-family: var(--font-mono);
		color: var(--color-text);
	}
	.frame {
		margin-top: var(--space-4);
	}
</style>
