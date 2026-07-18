<script lang="ts">
	// DEV-ONLY preview of the death-save track in the HP panel (EXPR-5). It's normally reachable only
	// by dropping a real character to 0 HP mid-combat, so this route loads the combat VM (same as the
	// combat page), forces the demo character to 0 HP, and renders the live HpPanel — the Death save
	// button really rolls (reading save.death / saves / d20_tests effects) and the pips toggle by hand.
	// Not linked from the app; gated to dev builds by /dev/+layout. Delete once it's easy to reach.
	import { onMount } from 'svelte';
	import { combat } from '../../combat/state.svelte';
	import HpPanel from '../../combat/blocks/HpPanel/HpPanel.svelte';

	const c = $derived(combat.character);
	const s = $derived(combat.sheet);

	onMount(async () => {
		await combat.load();
		if (combat.character) combat.character.play.hp.current = 0; // down the character so the track shows
	});
</script>

<div class="page">
	<h1>Dev preview · Death-save track (HP panel at 0 HP)</h1>
	<p>
		The <b>Death save</b> button rolls a real d20 (picking up <code>save.death</code>,
		<code>saves</code>
		and <code>d20_tests</code> effects), applies the RAW outcomes (nat 20 → 1 HP · nat 1 → two
		failures · three successes → stable), and logs it. The Success/Failure pips are also clickable
		to set by hand. Use <b>Heal ＋</b> to bring the character back up and watch the track disappear.
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
		font-size: 20px;
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
