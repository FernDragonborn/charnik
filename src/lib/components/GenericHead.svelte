<script lang="ts">
	// The "shapka" for every non-spell, non-monster article (species, class, feat, item, …): eyebrow,
	// title, an optional ability grid, and the generic key/value meta grid. Only the title is editable
	// (translate); the meta cells are read-only. Play-mode `actions` (Spellbook) render in the
	// dispatcher below the title, not here.
	import type { DetailModel } from '$lib/content/detail';
	import type { WikiEditDraft } from './wikiEdit';

	let {
		detail,
		editable = false,
		draft
	}: {
		detail: DetailModel;
		editable?: boolean;
		draft?: WikiEditDraft | undefined;
	} = $props();
</script>

<div class="deyebrow">{detail.eyebrow}</div>
{#if editable && draft}
	<input class="edit-title" bind:value={draft.name} placeholder={detail.title} />
{:else}
	<h1>{detail.title}</h1>
{/if}
{#if detail.abilities.length}
	<div class="abilities">
		{#each detail.abilities as a (a.ab)}
			<div class="ability-block">
				<span class="ability-code">{a.ab}</span>
				<span class="ability-score">{a.score}</span>
				<span class="markdown">{a.mod}</span>
			</div>
		{/each}
	</div>
{/if}
{#if detail.meta.length}
	<div class="detail-meta">
		{#each detail.meta as [k, v] (k)}
			<div class="meta-cell">
				<div class="meta-key">{k}</div>
				<div class="meta-value">{v}</div>
			</div>
		{/each}
	</div>
{/if}

<style>
	h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 30px;
		margin: 6px 0 12px;
	}
	.edit-title {
		width: 100%;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 28px;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: 8px;
		color: var(--color-text);
		padding: 4px 10px;
		margin: 4px 0 12px;
	}
	.edit-title:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.abilities {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 6px;
		margin-bottom: 16px;
	}
	.ability-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 9px;
		padding: 8px 4px;
		text-align: center;
	}
	.ability-block .ability-code {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
	}
	.ability-block .ability-score {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 17px;
	}
	.ability-block .markdown {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-accent-bright);
	}
	.meta-cell {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 10px;
		padding: 7px 11px;
	}
	.meta-cell :global(.meta-key) {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.meta-cell :global(.meta-value) {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 14px;
		margin-top: 2px;
		overflow-wrap: anywhere;
	}
	@media (max-width: 560px) {
		.abilities {
			grid-template-columns: repeat(3, 1fr);
		}
	}
</style>
