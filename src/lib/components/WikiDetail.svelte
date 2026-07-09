<script lang="ts">
	// Right-pane wiki detail: a thin DISPATCHER. It picks the per-type head (spell / monster / generic),
	// then stacks the shared ArticleProse (body + higher-level + material) and the attribution line. The
	// play-mode `actions` snippet (Spellbook) renders once under the head, type-independent — so it
	// shows on spells too (it used to only render in the generic branch). Read-only by default;
	// `editable` (translate) makes the title + prose editable via the bound `draft`.
	import type { Snippet } from 'svelte';
	import type { DetailModel } from '$lib/content/detail';
	import type { WikiEditDraft } from './wikiEdit';
	import SpellHead from './SpellHead.svelte';
	import MonsterHead from './MonsterHead.svelte';
	import GenericHead from './GenericHead.svelte';
	import ArticleProse from './ArticleProse.svelte';

	let {
		detail,
		actions,
		editable = false,
		draft
	}: {
		detail: DetailModel | null;
		actions?: Snippet;
		editable?: boolean;
		/** Mutated in place (its properties are bound); the parent owns the $state object. */
		draft?: WikiEditDraft;
	} = $props();

	// Which prose fields this article carries: spells have both, generic has higher-level only, monster
	// has neither. Empty string = absent → ArticleProse renders a field only when non-empty.
	const higherLevel = $derived(
		detail?.spell ? detail.spell.higherLevel : detail?.monster ? '' : (detail?.higherLevel ?? '')
	);
	const material = $derived(detail?.spell ? detail.spell.material : '');
</script>

<article class="detail-body">
	{#if !detail}
		<p class="pick">Select an entry to see its detail.</p>
	{:else}
		{#if detail.spell}
			<SpellHead {detail} spell={detail.spell} {editable} {draft} />
		{:else if detail.monster}
			<MonsterHead {detail} monster={detail.monster} {editable} {draft} />
		{:else}
			<GenericHead {detail} {editable} {draft} />
		{/if}

		{#if actions}<div class="dactions">{@render actions()}</div>{/if}

		<ArticleProse bodyMarkdown={detail.bodyHtml} {higherLevel} {material} {editable} {draft} />
		<div class="source-line">{detail.source} · CC-BY-4.0</div>
	{/if}
</article>

<style>
	.dactions {
		display: flex;
		gap: 14px;
		align-items: center;
		margin: 4px 0 16px;
		flex-wrap: wrap;
	}
	.pick {
		color: var(--color-text-muted);
		padding: 20px 22px;
	}
</style>
