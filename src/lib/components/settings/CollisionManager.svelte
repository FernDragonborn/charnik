<script lang="ts">
	// Collision resolution (collisions.json, PLAN invariant). The same `type:id` can legitimately live
	// in several sources (source-namespaced identity). When two overlap an edition — e.g. your homebrew
	// fork of an SRD spell, both active in 5e — this lets you keep ALL of them (they coexist, homebrew
	// sorts on top) or keep just ONE source. Live + persisted via sourceConfig; no reload.
	import { _ } from '$lib/i18n';
	import Icon from '../Icon.svelte';
	import { content } from '$lib/content/store.svelte';
	import { sourceLabel } from '$lib/content/detail';
	import {
		detectCollisions,
		sourceConfig,
		setCollision,
		KEEP_ALL,
	} from '$lib/content/sources.svelte';

	const graph = $derived(content.graph);
	const collisions = $derived(graph ? detectCollisions(graph) : []);
	const choiceOf = (key: string) => sourceConfig.collisions[key] ?? KEEP_ALL;
</script>

<section>
	<header class="sec-head">
		<h2>{$_('settings.collisions.title')}</h2>
		<p class="sec-note">{$_('settings.collisions.blurb')}</p>
	</header>

	{#if !graph}
		<p class="muted">{$_('settings.health.loading')}</p>
	{:else if collisions.length === 0}
		<div class="all-clear">
			<Icon name="check" size={13} />
			{$_('settings.collisions.allClear')}
		</div>
	{:else}
		{#each collisions as c (c.key)}
			<div class="collision">
				<div class="c-head">
					<span class="c-name">{c.name}</span>
					<span class="c-type"
						>{$_(`contentType.${c.type}`, { default: c.type.replace(/_/g, ' ') })}</span
					>
					<span class="c-id">{c.id}</span>
				</div>
				<div class="choices">
					<button
						class="choice"
						class:sel={choiceOf(c.key) === KEEP_ALL}
						onclick={() => setCollision(c.key, KEEP_ALL)}
					>
						{$_('settings.collisions.keepAll', { values: { count: c.sources.length } })}
					</button>
					{#each c.sources as src (src)}
						<button
							class="choice"
							class:sel={choiceOf(c.key) === src}
							onclick={() => setCollision(c.key, src)}
						>
							{$_('settings.collisions.only', { values: { source: sourceLabel(src) } })}
						</button>
					{/each}
				</div>
			</div>
		{/each}
	{/if}
</section>

<style>
	.collision {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-2-5) var(--space-3);
		margin-bottom: var(--space-2);
		background: var(--color-surface-2);
	}
	.c-head {
		display: flex;
		align-items: baseline;
		gap: var(--space-2-5);
		margin-bottom: var(--space-2);
	}
	.c-name {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-body);
	}
	.c-type {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.c-id {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
		margin-inline-start: auto;
	}
	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1-5);
	}
	.choice {
		font-size: var(--font-size-xs);
		padding: var(--space-1) var(--space-2-5);
		border-radius: var(--radius-full);
		border: 1px solid var(--color-border-strong);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.choice:hover {
		color: var(--color-text);
		border-color: var(--color-text-muted);
	}
	.choice.sel {
		color: var(--color-accent-bright);
		border-color: var(--color-accent);
		background: var(--color-accent-soft);
	}
</style>
