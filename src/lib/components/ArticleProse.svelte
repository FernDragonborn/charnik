<script lang="ts">
	// The shared PROSE of a wiki article: body text (+ optional "at higher levels" and spell material),
	// rendered read-only or as editable inputs. This is the translate surface — every type's head sits
	// ABOVE it; the dispatcher (WikiDetail) drops it in once per article. Body may be Markdown and/or
	// raw HTML (user-owned CSV): parsed with marked, then sanitized with DOMPurify so injected
	// <script>/on*/javascript: can't run.
	import { browser } from '$app/environment';
	import { renderContentMarkdown, renderContentMarkdownInline } from '$lib/content/markdown';
	import { _ } from '$lib/i18n';
	import type { WikiEditDraft } from './wikiEdit';

	let {
		bodyMarkdown,
		higherLevel = '',
		material = '',
		editable = false,
		draft,
	}: {
		/** The source body (raw Markdown/HTML); also the placeholder when editing. */
		bodyMarkdown: string;
		/** Source "at higher levels" prose — empty for types that don't have it (monster). */
		higherLevel?: string;
		/** Source spell material component — empty for non-spells. */
		material?: string;
		editable?: boolean;
		/** Absent in read mode; present (bound in place) only when translating. The `| undefined` is
		 *  required to thread this optional object down under `exactOptionalPropertyTypes`. */
		draft?: WikiEditDraft | undefined;
	} = $props();

	const bodyHtml = $derived(browser ? renderContentMarkdown(bodyMarkdown) : '');
	// These two are prose out of the same CSV cells as the body and carry the same Markdown, so they
	// go through the same seam. Interpolating them raw printed `**Ghouls**` and `_Magic Missile_`
	// verbatim on every spell that used emphasis outside the body.
	const higherHtml = $derived(browser ? renderContentMarkdownInline(higherLevel) : higherLevel);
	const materialHtml = $derived(browser ? renderContentMarkdownInline(material) : material);
</script>

{#if editable && draft}
	<textarea class="text-field edit-body" bind:value={draft.text} placeholder={bodyMarkdown}
	></textarea>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized above -->
{:else if bodyHtml}<div class="body">{@html bodyHtml}</div>{/if}

{#if higherLevel}
	{#if editable && draft}
		<label class="edit-line">
			<span class="eyebrow">{$_('contentField.higher_level')}</span>
			<textarea
				class="text-field edit-body short"
				bind:value={draft.higher_level}
				placeholder={higherLevel}></textarea>
		</label>
	{:else}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by renderContentMarkdownInline -->
		<div class="highlight">{$_('contentField.higher_level')} — {@html higherHtml}</div>
	{/if}
{/if}

{#if material}
	{#if editable && draft}
		<label class="edit-line">
			<span class="eyebrow">{$_('contentField.material')}</span>
			<input class="text-field edit-inline" bind:value={draft.material} placeholder={material} />
		</label>
	{:else}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by renderContentMarkdownInline -->
		<div class="source-line">{$_('contentField.material')} — {@html materialHtml}</div>
	{/if}
{/if}

<style>
	.body {
		font-size: var(--font-size-body);
		line-height: 1.5;
		color: var(--color-text);
	}
	.body :global(p) {
		margin: 0 0 var(--space-3);
	}
	/* A table may be wider than the column it is in — it scrolls in its OWN box (the wrapper the
	   renderer puts around it) rather than dragging the page sideways. On a phone a class feature's
	   spell table is 39px past a 320px screen, and every ancestor inherited that. */
	.body :global(.prose-table-scroll) {
		max-width: 100%;
		overflow-x: auto;
	}
	/* content tables (spell/item tables, embedded summon stat blocks) rendered from the CSV */
	.body :global(table) {
		width: 100%;
		border-collapse: collapse;
		margin: var(--space-1-5) 0 14px;
		font-size: var(--font-size-sm);
	}
	.body :global(th),
	.body :global(td) {
		border: 1px solid var(--color-border);
		padding: var(--space-1) var(--space-2);
		text-align: start;
		vertical-align: top;
	}
	.body :global(th) {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		background: var(--color-surface-2);
	}
	.body :global(hr) {
		border: 0;
		border-top: 1px solid var(--color-border);
		margin: var(--space-3) 0;
	}
	.body :global(h4),
	.body :global(h5) {
		font-family: var(--font-display);
		font-size: var(--font-size-xs);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin: 14px 0 var(--space-1-5);
	}
	.body :global(ul),
	.body :global(ol) {
		margin: 0 0 var(--space-3);
		padding-inline-start: 20px;
	}
	.body :global(li) {
		margin: 2px 0;
	}
	.highlight {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-inline-start: 3px solid var(--color-resource);
		border-radius: var(--radius);
		padding: var(--space-2-5) var(--space-3);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin: var(--space-1-5) 0 14px;
	}
	/* ---- editable (translate) inputs — prose spots only ---- */
	.edit-body {
		width: 100%;
		min-height: 180px;
		resize: vertical;
		font-family: var(--font-body);
		font-size: var(--font-size-body);
		line-height: 1.5;
		padding: var(--space-2-5) var(--space-3);
	}
	.edit-body.short {
		min-height: 70px;
	}
	.edit-line {
		display: block;
		margin: var(--space-2-5) 0;
	}
	.edit-line > span {
		display: block;
		font-size: var(--font-size-micro);
		margin-bottom: var(--space-1);
	}
	.edit-inline {
		width: 100%;
		font-family: var(--font-body);
		font-size: var(--font-size-body);
		padding: var(--space-1-5) var(--space-2-5);
	}
	.edit-body:focus,
	.edit-inline:focus {
		outline: none;
		border-color: var(--color-accent);
	}
</style>
