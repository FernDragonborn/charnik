<script lang="ts">
	// Right-pane wiki detail: a thin DISPATCHER. It picks the per-type head (spell / monster / generic),
	// then stacks the shared ArticleProse (body + higher-level + material) and the attribution line. The
	// play-mode `actions` snippet (Spellbook) renders once under the head, type-independent — so it
	// shows on spells too (it used to only render in the generic branch). Read-only by default;
	// `editable` (translate) makes the title + prose editable via the bound `draft`.
	import { sayText } from '$lib/util/say';
	import type { Snippet } from 'svelte';
	import { _ } from '$lib/i18n';
	import type { DetailModel } from '$lib/content/detail';
	import type { WikiEditDraft } from './wikiEdit';
	import SpellHead from './SpellHead.svelte';
	import MonsterHead from './MonsterHead.svelte';
	import GenericHead from './GenericHead.svelte';
	import ArticleProse from './ArticleProse.svelte';
	import OwnWords from './OwnWords.svelte';
	import { app } from '$lib/stores/app.svelte';
	import { overrides } from '$lib/content/overrides.svelte';

	let {
		detail,
		actions,
		footer,
		editable = false,
		draft,
	}: {
		detail: DetailModel | null;
		actions?: Snippet;
		/** Rendered at the bottom of the article (e.g. homebrew manage buttons), inside its padding/scroll. */
		footer?: Snippet;
		editable?: boolean;
		/** Mutated in place (its properties are bound); the parent owns the $state object. */
		draft?: WikiEditDraft;
	} = $props();

	// Which prose fields this article carries: spells have both, generic has higher-level only, monster
	// has neither. Empty string = absent → ArticleProse renders a field only when non-empty.
	const higherLevel = $derived.by(() => {
		if (detail?.spell) return detail.spell.higherLevel;
		if (detail?.monster) return '';
		return detail?.higherLevel ?? '';
	});
	const material = $derived(detail?.spell ? detail.spell.material : '');
	// What the reader sees is their own words when they wrote some. The shipped prose stays available
	// as the placeholder and as what "restore" puts back — this replaces nothing on disk.
	let rewriting = $state(false);
	const body = $derived(
		(detail ? overrides.textFor(detail.rowId, app.activeLocale) : undefined) ??
			detail?.bodyHtml ??
			'',
	);
</script>

<article class="detail-body">
	{#if !detail}
		<p class="pick">{$_('compendium.pickAnEntry')}</p>
	{:else}
		{#if detail.spell}
			<SpellHead {detail} spell={detail.spell} {editable} {draft} />
		{:else if detail.monster}
			<MonsterHead {detail} monster={detail.monster} {editable} {draft} />
		{:else}
			<GenericHead {detail} {editable} {draft} />
		{/if}

		{#if actions}<div class="dactions">{@render actions()}</div>{/if}

		<!-- BEFORE the prose, so the floated pencil sits at the top-right of the body text. Not while
		     TRANSLATING: that pane is already editing this prose, for everyone, in the file. -->
		{#if !editable}
			<OwnWords rowId={detail.rowId} original={detail.bodyHtml} bind:rewriting />
		{/if}
		<!-- the BODY goes empty while the rewrite editor is open, so the words stand once. `higherLevel`
		     and `material` keep rendering: a rewrite is the one prose string the override stores, and
		     dropping the whole block would hide two fields it cannot touch. -->
		<ArticleProse
			bodyMarkdown={rewriting ? '' : body}
			{higherLevel}
			{material}
			{editable}
			{draft}
		/>
		<div class="source-line">
			{sayText(detail.source, $_)}{#if detail.license}
				· {detail.license}{/if}
		</div>
		{#if footer}{@render footer()}{/if}
	{/if}
</article>

<style>
	.dactions {
		display: flex;
		gap: 14px;
		align-items: center;
		margin: var(--space-1) 0 var(--space-4);
		flex-wrap: wrap;
	}
	.pick {
		color: var(--color-text-muted);
		padding: 20px 22px;
	}
</style>
