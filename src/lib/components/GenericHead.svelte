<script lang="ts">
	// The "shapka" for every non-spell, non-monster article (species, class, feat, item, …): eyebrow,
	// title, an optional ability grid, and the generic key/value meta grid. Only the title is editable
	// (translate); the meta cells are read-only. Play-mode `actions` (Spellbook) render in the
	// dispatcher below the title, not here.
	import { abilityShortLabel } from '$lib/util/format';
	import { _ } from '$lib/i18n';
	import { say, sayText } from '$lib/util/say';
	import type { DetailModel } from '$lib/content/detail';
	import type { WikiEditDraft } from './wikiEdit';
	import EditableTitle from './EditableTitle.svelte';

	let {
		detail,
		editable = false,
		draft,
	}: {
		detail: DetailModel;
		editable?: boolean;
		draft?: WikiEditDraft | undefined;
	} = $props();
</script>

<div class="deyebrow">{detail.eyebrow.map((part) => say(part, $_)).join(' · ')}</div>
{#if editable && draft}
	<EditableTitle bind:value={draft.name} placeholder={detail.title} />
{:else}
	<h1>{detail.title}</h1>
{/if}
{#if detail.abilities.length}
	<div class="abilities">
		{#each detail.abilities as a (a.ab)}
			<div class="ability-block">
				<span class="ability-code">{abilityShortLabel(a.ab, $_)}</span>
				<span class="ability-score">{a.score}</span>
				<span class="markdown">{a.mod}</span>
			</div>
		{/each}
	</div>
{/if}
{#if detail.meta.length}
	<div class="detail-meta">
		{#each detail.meta as [k, v] (k.key)}
			<div class="meta-cell">
				<div class="meta-key eyebrow">{sayText(k, $_)}</div>
				<div class="meta-value">{say(v, $_)}</div>
			</div>
		{/each}
	</div>
{/if}

<style>
	h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-h2);
		margin: var(--space-1-5) 0 var(--space-3);
	}
	.abilities {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: var(--space-1-5);
		margin-bottom: var(--space-4);
	}
	.ability-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: var(--space-2) var(--space-1);
		text-align: center;
	}
	.ability-block .ability-code {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
	}
	.ability-block .ability-score {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-md);
	}
	.ability-block .markdown {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-accent-bright);
	}
	.meta-cell {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-1-5) var(--space-2-5);
	}
	.meta-cell :global(.meta-key) {
		font-size: var(--font-size-micro);
	}
	.meta-cell :global(.meta-value) {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-body);
		margin-top: 2px;
		overflow-wrap: anywhere;
	}
	@container article (max-width: 560px) {
		.abilities {
			grid-template-columns: repeat(3, 1fr);
		}
	}
</style>
