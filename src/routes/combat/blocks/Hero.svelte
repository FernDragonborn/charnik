<script lang="ts">
	// Character header: eyebrow (class · species), name, the level/system/proficiency subline with
	// the Level-up button, and the HP panel alongside. Reads the `combat` view-model; character +
	// sheet come in as props.
	import Portrait from '$lib/components/Portrait.svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import type { Character } from '$lib/character/schema';
	import type { CharacterSheet } from '$lib/character/derive';
	import { combat } from '../combat-view-model.svelte';
	import { _ } from '$lib/i18n';
	import { saveCharacterToStore } from '$lib/character/store.svelte';
	import { signed } from '$lib/combat/helpers';
	import { systemShortLabel } from '$lib/rules/pipeline';
	import HpPanel from './HpPanel/HpPanel.svelte';
	import Exhaustion from './Exhaustion.svelte';

	let { c, s }: { c: Character; s: CharacterSheet } = $props();
	const className = $derived(combat.className);
	const speciesName = $derived(combat.speciesName);
</script>

<section class="hero">
	<div class="who">
		<!-- shown only when this character HAS one: an empty placeholder on every sheet would be a
		     permanent nag for the many players who never add a picture -->
		{#if c.build.photo}
			<Portrait
				source={{ kind: 'stored', id: c.id, name: c.build.photo }}
				size={72}
				alt={$_('character.portraitOf', { values: { name: c.build.name } })}
			/>
		{/if}
		<div>
			<div class="eyebrow">{className}{speciesName ? ` · ${speciesName}` : ''}</div>
			<h1>{c.build.name}</h1>
			<div class="subline">
				<!-- Levelling up rides the LEVEL itself rather than a button beside it: the number is what a
				     player looks at when they think about levelling, and a separate control had to compete
				     with the line of facts around it for the same attention. -->
				{#if combat.canLevelUp}
					<button
						class="levelup"
						title={$_('combat.hero.levelUpTo', { values: { level: s.level + 1 } })}
						onclick={async () => {
							await saveCharacterToStore(c); // persist first (e.g. the demo) so the builder can load it
							void goto(`${base}/build?levelup=${c.id}`);
						}}
					>
						{$_('combat.hero.level')}
						<b>{s.level}</b>
					</button>
				{:else}
					{$_('combat.hero.level')}
					<b>{s.level}</b>
				{/if}
				· <span class="system-badge">{systemShortLabel(c.system)}</span> · {$_(
					'combat.hero.proficiency',
				)}
				<b>{signed(s.proficiencyBonus)}</b>
			</div>
		</div>
	</div>
	<div class="hp-col">
		<HpPanel {c} {s} />
		<Exhaustion {c} />
	</div>
</section>

<style>
	.hero {
		display: grid;
		grid-template-columns: 1fr 1.35fr;
		gap: 22px;
		align-items: end;
		margin-bottom: var(--space-4);
	}
	/* HP panel (primary) + Exhaustion block (its own component) side by side — read left→right.
	   `wrap` is the narrow-screen fallback: exhaustion drops below HP instead of overflowing. */
	.hp-col {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: stretch;
	}
	.who {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.eyebrow {
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		font-size: var(--font-size-xs);
		color: var(--color-accent-bright);
	}
	h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-2xl);
		line-height: 1.02;
		letter-spacing: -0.02em;
		margin: var(--space-1-5) 0 var(--space-1);
	}
	.subline {
		color: var(--color-text-muted);
		font-size: var(--font-size-body);
	}
	.subline b {
		color: var(--color-resource);
		font-weight: 600;
	}
	/* it reads as the text it replaced — the line says the same words — and marks itself as a control
	   the way every other inline one here does: on hover, and under the keyboard's focus ring */
	.levelup {
		padding: 0;
		border: 0;
		background: transparent;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}
	.levelup:hover b,
	.levelup:focus-visible b {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.system-badge {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		padding: 1px var(--space-1-5);
	}
	@media (max-width: 640px) {
		.hero {
			grid-template-columns: 1fr;
		}
	}
</style>
