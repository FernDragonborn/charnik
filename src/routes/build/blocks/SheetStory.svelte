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
	import { why } from '$lib/combat/effects-view';
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
					title="{$_('build.story.barHint', {
						values: { skill: bar.via, passive: bar.passive }
					})} — {why(bar.trace)}"
				>
					<span class="blabel">{$_(`build.social.${bar.id}`)}</span>
					<span class="meter"><span style:width="{bar.fill * 100}%"></span></span>
					<span class="bvia">{bar.via} {bar.passive}</span>
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
				<ul>
					{#each bullets.slice(0, 4) as line, i (i)}<li>{line}</li>{/each}
				</ul>
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
		gap: 16px;
		align-items: start;
	}
	.bars {
		display: flex;
		flex-direction: column;
		gap: 9px;
	}
	.bar {
		display: grid;
		grid-template-columns: 96px minmax(0, 1fr) auto;
		align-items: center;
		gap: 9px;
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
		gap: 6px;
		padding: 10px 12px;
		border-color: var(--color-border);
		background: var(--color-surface-2);
		text-align: left;
	}
	.notes ul {
		margin: 0;
		padding-left: 17px;
		font-size: var(--font-size-xs);
		line-height: 1.55;
	}
	.empty-note,
	.more {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
</style>
