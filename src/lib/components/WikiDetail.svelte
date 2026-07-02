<script lang="ts">
	// Right-pane wiki detail rendered from a content CSV row (d-spellmgr design). Shared by
	// the Compendium (read-only) and the Spellbook (passes an `actions` snippet). The body
	// text may be Markdown and/or contain HTML markup (that's OK — user-owned CSV): it's
	// parsed with marked, then sanitized with DOMPurify so injected <script>/on*/javascript:
	// can't run.
	import type { Snippet } from 'svelte';
	import { browser } from '$app/environment';
	import DOMPurify from 'dompurify';
	import { marked } from 'marked';
	import type { DetailModel } from '$lib/content/detail';

	let { detail, actions }: { detail: DetailModel | null; actions?: Snippet } = $props();

	const bodyHtml = $derived(
		detail && browser ? DOMPurify.sanitize(marked.parse(detail.bodyHtml, { async: false })) : ''
	);
</script>

<article class="detail">
	{#if detail}
		<div class="deyebrow">{detail.eyebrow}</div>
		<h1>{detail.title}</h1>
		{#if actions}<div class="dactions">{@render actions()}</div>{/if}
		{#if detail.abilities.length}
			<div class="abilities">
				{#each detail.abilities as a (a.ab)}
					<div class="abil">
						<span class="ab">{a.ab}</span>
						<span class="sc">{a.score}</span>
						<span class="md">{a.mod}</span>
					</div>
				{/each}
			</div>
		{/if}
		{#if detail.meta.length}
			<div class="meta">
				{#each detail.meta as [k, v] (k)}
					<div class="mcell">
						<div class="k">{k}</div>
						<div class="v">{v}</div>
					</div>
				{/each}
			</div>
		{/if}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized above -->
		{#if bodyHtml}<div class="body">{@html bodyHtml}</div>{/if}
		{#if detail.higherLevel}
			<div class="hl">At higher levels — {detail.higherLevel}</div>
		{/if}
		<div class="src">{detail.source} · CC-BY-4.0</div>
	{:else}
		<p class="pick">Select an entry to see its detail.</p>
	{/if}
</article>

<style>
	.detail {
		padding: 20px 22px;
		overflow: auto;
		min-height: 0;
	}
	.deyebrow {
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.18em;
		font-size: 11px;
		color: var(--color-accent-bright);
	}
	.detail h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 30px;
		margin: 6px 0 12px;
	}
	.dactions {
		display: flex;
		gap: 14px;
		align-items: center;
		margin: 4px 0 16px;
		flex-wrap: wrap;
	}
	.abilities {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 6px;
		margin-bottom: 16px;
	}
	.abil {
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
	.abil .ab {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
	}
	.abil .sc {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 17px;
	}
	.abil .md {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-accent-bright);
	}
	@media (max-width: 560px) {
		.abilities {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	.meta {
		display: grid;
		/* short values (AC, size, CR…) pack more per row instead of two giant boxes */
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 8px;
		margin-bottom: 16px;
	}
	.mcell {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 10px;
		padding: 7px 11px;
	}
	.mcell :global(.k) {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.mcell :global(.v) {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 14px;
		margin-top: 2px;
		overflow-wrap: anywhere;
	}
	.body {
		font-size: 14px;
		line-height: 1.5;
		color: var(--color-text);
	}
	.body :global(p) {
		margin: 0 0 12px;
	}
	.hl {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-left: 3px solid var(--color-resource);
		border-radius: 8px;
		padding: 10px 13px;
		font-size: 13px;
		color: var(--color-text-muted);
		margin: 6px 0 14px;
	}
	.src {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
		border-top: 1px solid var(--color-border);
		padding-top: 11px;
	}
	.pick {
		color: var(--color-text-muted);
		padding: 20px 22px;
	}
</style>
