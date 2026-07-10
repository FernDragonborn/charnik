<script lang="ts">
	// Collision resolution (collisions.json, PLAN invariant). The same `type:id` can legitimately live
	// in several sources (source-namespaced identity). When two overlap an edition — e.g. your homebrew
	// fork of an SRD spell, both active in 5e — this lets you keep ALL of them (they coexist, homebrew
	// sorts on top) or keep just ONE source. Live + persisted via sourceConfig; no reload.
	import { content } from '$lib/content/store.svelte';
	import { sourceLabel } from '$lib/content/detail';
	import { detectCollisions, sourceConfig, setCollision } from '$lib/content/sources.svelte';

	const graph = $derived(content.graph);
	const collisions = $derived(graph ? detectCollisions(graph) : []);
	const choiceOf = (key: string) => sourceConfig.collisions[key] ?? 'all';
</script>

<section>
	<header class="sec-head">
		<h2>Collisions</h2>
		<p class="sec-note">
			Entries that share the same id across more than one source and overlap an edition. Keep them
			all (they coexist — your homebrew sorts above the original) or pick a single source to show.
		</p>
	</header>

	{#if !graph}
		<p class="muted">Loading…</p>
	{:else if collisions.length === 0}
		<div class="all-clear">✓ No collisions — every entry’s id is unambiguous in its edition.</div>
	{:else}
		{#each collisions as c (c.key)}
			<div class="collision">
				<div class="c-head">
					<span class="c-name">{c.name}</span>
					<span class="c-type">{c.type.replace(/_/g, ' ')}</span>
					<span class="c-id">{c.id}</span>
				</div>
				<div class="choices">
					<button
						class="choice"
						class:sel={choiceOf(c.key) === 'all'}
						onclick={() => setCollision(c.key, 'all')}
					>
						Keep all ({c.sources.length})
					</button>
					{#each c.sources as src (src)}
						<button
							class="choice"
							class:sel={choiceOf(c.key) === src}
							onclick={() => setCollision(c.key, src)}
						>
							Only {sourceLabel(src)}
						</button>
					{/each}
				</div>
			</div>
		{/each}
	{/if}
</section>

<style>
	.sec-head h2 {
		font-family: var(--font-display);
		font-size: 18px;
		margin: 0 0 4px;
	}
	.sec-note {
		color: var(--color-text-muted);
		font-size: 13px;
		margin: 0 0 16px;
		max-width: 640px;
	}
	.muted {
		color: var(--color-text-muted);
		font-size: 13px;
	}
	.all-clear {
		color: var(--color-good);
		font-size: 14px;
		border: 1px solid var(--color-good);
		border-radius: 10px;
		padding: 12px 14px;
		background: var(--color-good-soft);
	}
	.collision {
		border: 1px solid var(--color-border);
		border-radius: 10px;
		padding: 10px 12px;
		margin-bottom: 8px;
		background: var(--color-surface-2);
	}
	.c-head {
		display: flex;
		align-items: baseline;
		gap: 10px;
		margin-bottom: 8px;
	}
	.c-name {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 15px;
	}
	.c-type {
		font-size: 12px;
		color: var(--color-text-muted);
	}
	.c-id {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--color-text-muted);
		margin-left: auto;
	}
	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.choice {
		font-size: 12px;
		padding: 4px 11px;
		border-radius: 20px;
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
