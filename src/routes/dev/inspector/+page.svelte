<script lang="ts">
	// DEV-ONLY: every builder inspector target, side by side, over one shared draft.
	//
	// The inspector deliberately has a DIFFERENT body per target (a feat slot is not an ability
	// allocator), which means a change to the shell can break one pane while the other seven look
	// fine. This page renders them all at once so that never goes unnoticed: each column owns its own
	// `Inspector` instance pointed at a different target, and they all read the same `build` draft.
	//
	// Not linked from the app; gated to dev builds by /dev/+layout.
	import { onMount } from 'svelte';
	import { build } from '../../build/build-view-model.svelte';
	import { Inspector, type InspectorTarget } from '../../build/inspector.svelte';
	import InspectorPane from '../../build/blocks/Inspector.svelte';
	import '$lib/styles/build.css';

	interface Target {
		label: string;
		target: InspectorTarget;
	}
	interface Column {
		label: string;
		inspector: Inspector;
	}
	/** Built ONCE after the draft is set up, not derived: constructing an Inspector is a side effect,
	 *  and a `$derived` that re-runs would hand every pane a fresh one on each keystroke (ui.md). */
	let columns = $state<Column[]>([]);

	// A draft rich enough that every target has something to show: a class with subclasses and feat
	// slots, a species with lineages, a caster if the content has one.
	onMount(async () => {
		await build.load();
		build.reset();
		build.draft.name = 'Inspector Probe';
		build.draft.speciesId = build.speciesList[0]?.effectiveId ?? null;
		build.draft.backgroundId = build.backgroundList[0]?.effectiveId ?? null;
		const caster = build.classList.find((c) => c.data.caster !== 'none');
		build.classRows.setClass(0, (caster ?? build.classList[0])?.effectiveId ?? null);
		for (let i = 0; i < 7; i++) build.classRows.bumpClassLevel(0, 1); // level 8 → subclass + two feat slots

		const slot = build.feats.featSlots[0];
		const lineage: Target[] = build.speciesOptions.length
			? [{ label: 'lineage', target: { id: 'speciesOption' } }]
			: [];
		const featSlot: Target[] = slot
			? [{ label: 'feat slot', target: { id: 'feat', slotKey: slot.key, level: slot.level } }]
			: [];
		const targets: Target[] = [
			{ label: 'species', target: { id: 'species' } },
			...lineage,
			{ label: 'background', target: { id: 'background' } },
			{ label: 'origin feat', target: { id: 'originFeat' } },
			{ label: 'class', target: { id: 'class', index: 0 } },
			{ label: 'subclass', target: { id: 'subclass', index: 0 } },
			...featSlot,
			{ label: 'abilities', target: { id: 'abilities' } },
			{ label: 'skills', target: { id: 'skills' } },
			{ label: 'masteries', target: { id: 'masteries' } },
			{ label: 'languages', target: { id: 'languages' } },
			{ label: 'spells', target: { id: 'spells' } },
			{ label: 'inventory', target: { id: 'inventory' } },
			{ label: 'notes', target: { id: 'notes' } },
		];
		columns = targets.map(({ label, target }) => {
			const inspector = new Inspector(() => build);
			inspector.open(target);
			return { label, inspector };
		});
	});
</script>

<div class="page build-page">
	<h1>Dev preview · every inspector target</h1>
	<p class="hint">
		One shared draft ({build.draft.name || 'unnamed'} · level {build.classRows.totalLevel}), one
		column per target, each with its own <code>Inspector</code>. If a pane renders blank, that
		target's body component is broken — the others will keep working, which is exactly why this page
		exists.
	</p>

	{#if !columns.length}
		<p class="loading">Loading content…</p>
	{:else}
		<div class="grid">
			{#each columns as col (col.label)}
				<section class="col">
					<h2>{col.label}</h2>
					<div class="frame"><InspectorPane inspector={col.inspector} /></div>
				</section>
			{/each}
		</div>
	{/if}
</div>

<style>
	.page {
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h1 {
		font-family: var(--font-display);
		font-size: var(--font-size-lg);
		margin: 0;
	}
	.hint {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		max-width: 70ch;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
		gap: var(--space-4);
		align-items: start;
	}
	.col h2 {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		color: var(--color-text-muted);
		margin: 0 0 var(--space-1-5);
	}
	/* a DEFINITE height, not a max: a pane is a fixed-height box whose list scrolls inside it, and
	   against an auto-height parent that collapses to "however tall the content is" — which is the
	   one shape this page exists to catch a break in. */
	.frame {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg);
		padding: 14px;
		height: 720px;
		overflow: hidden;
	}
</style>
