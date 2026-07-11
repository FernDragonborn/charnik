<script lang="ts">
	// Character header: eyebrow (class · species), name, the level/system/proficiency subline with
	// the Level-up button, and the HP panel alongside. Reads the `combat` view-model; character +
	// sheet come in as props.
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import type { Character } from '$lib/character/schema';
	import type { CharacterSheet } from '$lib/character/derive';
	import { combat } from '../state.svelte';
	import { saveCharacterToStore } from '$lib/character/store.svelte';
	import { signed } from '$lib/combat/helpers';
	import HpPanel from './HpPanel/HpPanel.svelte';

	let { c, s }: { c: Character; s: CharacterSheet } = $props();
	const className = $derived(combat.className);
	const speciesName = $derived(combat.speciesName);
</script>

<section class="hero">
	<div>
		<div class="eyebrow">{className}{speciesName ? ` · ${speciesName}` : ''}</div>
		<h1>{c.build.name}</h1>
		<div class="subline">
			Level <b>{s.level}</b> · <span class="system-badge">{c.system}</span> · Proficiency
			<b>{signed(s.proficiencyBonus)}</b>
			{#if combat.canLevelUp}
				<button
					class="levelup"
					onclick={async () => {
						await saveCharacterToStore(c); // persist first (e.g. the demo) so the builder can load it
						goto(`${base}/build?levelup=${c.id}`);
					}}>▲ Level up</button
				>
			{/if}
		</div>
	</div>
	<HpPanel {c} {s} />
</section>

<style>
	.hero {
		display: grid;
		grid-template-columns: 1.5fr 1fr;
		gap: 22px;
		align-items: end;
		margin-bottom: 16px;
	}
	.eyebrow {
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		font-size: 11px;
		color: var(--color-accent-bright);
	}
	h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-2xl);
		line-height: 1.02;
		letter-spacing: -0.02em;
		margin: 7px 0 4px;
	}
	.subline {
		color: var(--color-text-muted);
		font-size: 14px;
	}
	.subline b {
		color: var(--color-resource);
		font-weight: 600;
	}
	.levelup {
		margin-left: 8px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
		color: var(--color-good);
		background: var(--color-good-soft);
		border: 1px solid var(--color-good);
		border-radius: 7px;
		padding: 3px 10px;
		cursor: pointer;
	}
	.levelup:hover {
		filter: brightness(1.15);
	}
	.system-badge {
		font-family: var(--font-mono);
		font-size: 11px;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		padding: 1px 6px;
	}
	@media (max-width: 640px) {
		.hero {
			grid-template-columns: 1fr;
		}
	}
</style>
