<script lang="ts">
	// The shared PROSE of a wiki article: body text (+ optional "at higher levels" and spell material),
	// rendered read-only or as editable inputs. This is the translate surface — every type's head sits
	// ABOVE it; the dispatcher (WikiDetail) drops it in once per article. Body may be Markdown and/or
	// raw HTML (user-owned CSV): parsed with marked, then sanitized with DOMPurify so injected
	// <script>/on*/javascript: can't run.
	import { browser } from '$app/environment';
	import DOMPurify from 'dompurify';
	import { marked } from 'marked';
	import type { WikiEditDraft } from './wikiEdit';

	let {
		bodyMarkdown,
		higherLevel = '',
		material = '',
		editable = false,
		draft
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

	// Some content mixes Markdown with raw HTML tables. marked won't process Markdown that sits
	// inside/right after an HTML block, so: force blank lines around <table> (so the following text
	// parses as Markdown), then mop up emphasis left literal inside table cells.
	function renderBody(md: string): string {
		const spaced = md.replace(/\n*(<table>)/g, '\n\n$1').replace(/(<\/table>)\n*/g, '$1\n\n');
		let html = marked.parse(spaced, { async: false }) as string;
		html = html
			.replace(/\*\*([^*<>\n]+)\*\*/g, '<strong>$1</strong>')
			.replace(/\*([^*<>\n]+)\*/g, '<em>$1</em>');
		return DOMPurify.sanitize(html);
	}
	const bodyHtml = $derived(browser ? renderBody(bodyMarkdown) : '');
</script>

{#if editable && draft}
	<textarea class="edit-body" bind:value={draft.text} placeholder={bodyMarkdown}></textarea>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized above -->
{:else if bodyHtml}<div class="body">{@html bodyHtml}</div>{/if}

{#if higherLevel}
	{#if editable && draft}
		<label class="edit-line">
			<span>At higher levels</span>
			<textarea class="edit-body short" bind:value={draft.higher_level} placeholder={higherLevel}
			></textarea>
		</label>
	{:else}
		<div class="highlight">At higher levels — {higherLevel}</div>
	{/if}
{/if}

{#if material}
	{#if editable && draft}
		<label class="edit-line">
			<span>Material</span>
			<input class="edit-inline" bind:value={draft.material} placeholder={material} />
		</label>
	{:else}
		<div class="source-line">Material — {material}</div>
	{/if}
{/if}

<style>
	.body {
		font-size: 14px;
		line-height: 1.5;
		color: var(--color-text);
	}
	.body :global(p) {
		margin: 0 0 12px;
	}
	/* content tables (spell/item tables, embedded summon stat blocks) rendered from the CSV */
	.body :global(table) {
		width: 100%;
		border-collapse: collapse;
		margin: 6px 0 14px;
		font-size: 13px;
	}
	.body :global(th),
	.body :global(td) {
		border: 1px solid var(--color-border);
		padding: 5px 9px;
		text-align: left;
		vertical-align: top;
	}
	.body :global(th) {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		background: var(--color-surface-2);
	}
	.body :global(hr) {
		border: 0;
		border-top: 1px solid var(--color-border);
		margin: 12px 0;
	}
	.body :global(h4),
	.body :global(h5) {
		font-family: var(--font-display);
		font-size: 12px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin: 14px 0 6px;
	}
	.body :global(ul),
	.body :global(ol) {
		margin: 0 0 12px;
		padding-left: 20px;
	}
	.body :global(li) {
		margin: 2px 0;
	}
	.highlight {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-left: 3px solid var(--color-resource);
		border-radius: 8px;
		padding: 10px 13px;
		font-size: 13px;
		color: var(--color-text-muted);
		margin: 6px 0 14px;
	}
	/* ---- editable (translate) inputs — prose spots only ---- */
	.edit-body {
		width: 100%;
		min-height: 180px;
		resize: vertical;
		font-family: var(--font-body);
		font-size: 14px;
		line-height: 1.5;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: 8px;
		color: var(--color-text);
		padding: 10px 12px;
	}
	.edit-body.short {
		min-height: 70px;
	}
	.edit-line {
		display: block;
		margin: 10px 0;
	}
	.edit-line > span {
		display: block;
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin-bottom: 4px;
	}
	.edit-inline {
		width: 100%;
		font-family: var(--font-body);
		font-size: 14px;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: 8px;
		color: var(--color-text);
		padding: 7px 10px;
	}
	.edit-body:focus,
	.edit-inline:focus {
		outline: none;
		border-color: var(--color-accent);
	}
</style>
