<script lang="ts">
	// The linked half of an article that owns a second table (`linked-tables.ts` says which): the
	// rows joined to it, and the way to write one more. Both directions are here on purpose — the
	// list is how you reach a row to edit or delete it (its own article carries those), and Add is
	// how you write the next one with the join columns already filled, since a foreign key is an id
	// nobody can guess.
	import { _ } from '$lib/i18n';
	import Icon from './Icon.svelte';
	import { localizedName } from '$lib/content/detail';
	import { linkOf, linkedLevel, linkedPrefill, linkedRowsOf } from '$lib/content/linked-tables';
	import type { ContentGraph, LoadedRow } from '$lib/content/loader';
	import type { ContentType } from '$lib/content/schemas';

	let {
		parent,
		graph,
		locale,
		onopen,
		onadd,
	}: {
		/** The article's row. Renders nothing unless its type owns a linked table. */
		parent: LoadedRow;
		graph: ContentGraph;
		locale: string;
		onopen: (row: LoadedRow) => void;
		/** Start an add-form for the child type, seeded with the join columns. */
		onadd: (type: ContentType, prefill: Record<string, string>) => void;
	} = $props();

	const link = $derived(linkOf(parent));
	const rows = $derived(linkedRowsOf(graph, parent, locale));
	const prefill = $derived(linkedPrefill(parent));

	const childLabel = $derived(
		link ? $_(`contentType.${link.child}`, { default: link.child.replace(/_/g, ' ') }) : '',
	);
</script>

{#if link}
	<section class="linked">
		<div class="linked-head">
			<span class="eyebrow">{childLabel}</span>
			<button class="hb-btn" onclick={() => onadd(link.child, prefill)}>
				<Icon name="plus" size={14} />
				{$_('compendium.addLinked', { values: { type: childLabel.toLocaleLowerCase(locale) } })}
			</button>
		</div>
		{#if rows.length === 0}
			<p class="muted">{$_('compendium.noLinked')}</p>
		{:else}
			<ul class="linked-list">
				{#each rows as r (r.effectiveId)}
					<li>
						<button class="linked-row" onclick={() => onopen(r)}>
							{#if linkedLevel(r)}
								<span class="lvl"
									>{$_('compendium.levelNth', { values: { level: linkedLevel(r) } })}</span
								>
							{/if}
							<span class="lname">{localizedName(r, locale)}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<style>
	.linked {
		margin-top: 22px;
		border-top: 1px solid var(--color-border);
		padding-top: var(--space-4);
	}
	.linked-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}
	.linked-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.linked-row {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		width: 100%;
		text-align: start;
		background: none;
		border: 0;
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		color: var(--color-text);
		cursor: pointer;
		font: inherit;
	}
	.linked-row:hover,
	.linked-row:focus-visible {
		background: var(--color-surface-2);
	}
	.lvl {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		min-width: 4.5em;
	}
	.muted {
		color: var(--color-text-muted);
		margin: 0;
	}
</style>
