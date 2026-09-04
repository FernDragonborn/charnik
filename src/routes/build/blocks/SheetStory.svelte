<script lang="ts">
	// Who this person is away from the initiative order.
	//
	// The three bars are NOT a new rule: each is the best passive score among a handful of skills the
	// sheet already computed, scaled between a hopeless character and a legendary one (lib/build/social).
	// It answers "what is this character like in a scene?" without reading eighteen rows, and it moves
	// on its own as abilities and proficiencies change. Nothing reads them but a human.
	//
	// The notes are free prose for the table — one bullet per line, no mechanics attached.
	import { _ } from '$lib/i18n';
	import { build } from '../build-view-model.svelte';
	import { socialBars } from '$lib/build/social';
	import { skillLabel } from '../rows';
	import { why } from '$lib/combat/effects-view';
	import { provenance } from '$lib/actions/provenance';
	const b = build;

	const bars = $derived(socialBars(b.sheet?.passives));
	const bullets = $derived(b.draft.notes.split('\n').filter((line) => line.trim()));
</script>

<div class="card">
	<div class="card-head">
		<span class="eyebrow">{$_('build.story.title')}</span>
		<span class="spacer"></span>
		<span class="trail">{$_('build.story.hint')}</span>
	</div>

	<div class="split">
		<div class="bars">
			{#each bars as bar (bar.id)}
				<div
					class="bar"
					use:provenance={`${$_('build.story.barHint', {
						values: { skill: skillLabel(bar.via, $_), passive: bar.passive }
					})} — ${why(bar.trace)}`}
				>
					<span class="blabel">{$_(`build.social.${bar.id}`)}</span>
					<span class="meter"><span style:width="{bar.fill * 100}%"></span></span>
					<span class="bvia">{skillLabel(bar.via, $_)} {bar.passive}</span>
				</div>
			{/each}
		</div>

		<button
			class="slot notes"
			class:active={b.inspector.isOpen({ id: 'notes' })}
			onclick={() => b.inspector.toggle({ id: 'notes' })}
		>
			<span class="eyebrow">{$_('build.story.heading')}</span>
			{#if bullets.length}
				<!-- spans, not a list: a button's content model is phrasing content, and a `<ul>` inside
				     one is invalid — the lines are a preview of the notes, not a list to navigate -->
				<span class="lines">
					{#each bullets.slice(0, 4) as line, i (i)}<span class="line">{line}</span>{/each}
				</span>
				{#if bullets.length > 4}<span class="more"
						>{$_('build.story.more', { values: { count: bullets.length - 4 } })}</span
					>{/if}
			{:else}
				<span class="empty-note">{$_('build.story.empty')}</span>
			{/if}
		</button>
	</div>
</div>

<style>
	.split {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
		gap: var(--space-4);
		align-items: start;
	}
	.bars {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.bar {
		display: grid;
		grid-template-columns: 96px minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-2);
	}
	.blabel {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.bvia {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
		white-space: nowrap;
	}
	.notes {
		display: flex;
		flex-direction: column;
		gap: var(--space-1-5);
		padding: var(--space-2-5) var(--space-3);
		border-color: var(--color-border);
		background: var(--color-surface-2);
		text-align: start;
	}
	.notes .lines {
		display: flex;
		flex-direction: column;
		font-size: var(--font-size-xs);
		line-height: 1.55;
	}
	/* the bullet a `<li>` used to draw, on a span that is allowed inside a button */
	.notes .line::before {
		content: '·';
		color: var(--color-text-muted);
		margin-inline-end: var(--space-1-5);
	}
	.empty-note,
	.more {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
</style>
