<script lang="ts">
	// The right pane. A shared shell — eyebrow, title, one sentence of what this choice IS, then a
	// body — around a body component chosen per target, because a feat slot and a notes field are not
	// the same question and forcing them into one layout makes both worse. Every target is rendered
	// side by side at /dev/inspector.
	//
	// There is no commit footer: a click on an option TAKES it. The only thing left down there is
	// Clear, because un-making a choice has no other affordance.
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import { build } from '../build-view-model.svelte';
	import { targetKey, type EditPane, type Inspector } from '../inspector.svelte';
	import InspectorGrid from './InspectorGrid.svelte';
	import FeatPane from './FeatPane.svelte';
	import OriginFeatPane from './OriginFeatPane.svelte';
	import AbilitiesPane from './AbilitiesPane.svelte';
	import SkillsPane from './SkillsPane.svelte';
	import LanguagesPane from './LanguagesPane.svelte';
	import SpellsPane from './SpellsPane.svelte';
	import InventoryPane from './InventoryPane.svelte';
	import NotesPane from './NotesPane.svelte';
	import type { Component } from 'svelte';
	const b = build;

	/** Which component answers each edit target. A table keyed by the pane union, so a pane added to
	 *  `EDIT_PANES` and forgotten here is a type error rather than a blank pane. */
	const PANE_COMPONENT: Record<EditPane, Component> = {
		abilities: AbilitiesPane,
		originFeat: OriginFeatPane,
		skills: SkillsPane,
		languages: LanguagesPane,
		spells: SpellsPane,
		inventory: InventoryPane,
		notes: NotesPane,
	};
	// defaults to the page's shared inspector; /dev/inspector passes its own so it can show every
	// target at once, each previewing against the same draft.
	let { inspector = build.inspector }: { inspector?: Inspector } = $props();
	const ins = $derived(inspector);

	const spec = $derived(ins.spec);
	const target = $derived(ins.target);

	/**
	 * A click on the pane's own background drops the highlight.
	 *
	 * The highlight is what the diff and any open card are about, so leaving it lit after you have
	 * clicked away from everything says the pane is still talking about an option you stopped looking
	 * at. Anything you can actually operate keeps its click — this only fires on the space between.
	 */
	// The open article card is a DOM descendant of the pane (`position: fixed` does not move it out of
	// the bubbling path), and it is the highlight's own content — so a click on a paragraph of it must
	// not be read as clicking away from the thing you are reading.
	const OPERABLE = 'button, a, input, textarea, select, label, [role="option"], .picker-card';
	function clearOnBackground(event: MouseEvent) {
		const el = event.target;
		if (el instanceof Element && el.closest(OPERABLE)) return;
		ins.previewId = null;
	}

	/**
	 * …and closing it hands the caret back to whatever opened it — the other half of the picker's
	 * focus contract (the command palette's `restoreEl` does the same thing for the same reason).
	 *
	 * `$effect.pre`, because it has to read `document.activeElement` BEFORE the pane re-renders — by
	 * the time an ordinary effect runs the search box has already taken the caret. The pane guard
	 * covers the other direction: switching targets must not overwrite the opener with the box.
	 */
	let pane = $state<HTMLElement | null>(null);
	let openerEl: HTMLElement | null = null;
	let wasOpen = false;
	$effect.pre(() => {
		const isOpen = ins.target !== null;
		const active = document.activeElement;
		if (isOpen) {
			if (active instanceof HTMLElement && !pane?.contains(active)) openerEl = active;
		} else if (wasOpen) openerEl?.focus();
		wasOpen = isOpen;
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="pane"
	bind:this={pane}
	onclick={clearOnBackground}
	onkeydown={(e) => e.code === 'Escape' && (ins.previewId = null)}
>
	{#if !spec || !target}
		<!-- resting state: not empty space, but the shortest path to a finished character -->
		<div class="head">
			<span class="eyebrow">{$_('build.inspector.label')}</span>
		</div>
		<h2>{$_('build.inspector.restingTitle')}</h2>
		<p class="blurb">{$_('build.inspector.restingBody')}</p>
		{#if b.blocking.length}
			<div class="resting">
				<span class="eyebrow">{$_('build.inspector.stillToDo')}</span>
				<div class="todolist">
					{#each b.blocking as todo (todo.key + JSON.stringify(todo.values ?? {}))}
						{@const t = b.todoTarget(todo)}
						{#if t}
							<button class="todo" onclick={() => ins.open(t)}>
								<Icon name="chevron-right" size={12} />
								{$_(`build.todo.${todo.key}`, { values: todo.values })}
							</button>
						{:else}
							<span class="todo static"
								><Icon name="chevron-right" size={12} />{$_(`build.todo.${todo.key}`, {
									values: todo.values
								})}</span
							>
						{/if}
					{/each}
				</div>
			</div>
		{:else}
			<div class="resting done">
				<span class="eyebrow ok">{$_('build.inspector.nothingMissing')}</span>
				<p class="blurb">{$_('build.inspector.nothingMissingBody')}</p>
			</div>
		{/if}
	{:else}
		<div class="head">
			<span class="eyebrow">{$_('build.inspector.label')}</span>
			<span class="spacer"></span>
			<button class="icon-button" aria-label={$_('build.inspector.close')} onclick={ins.close}>
				<Icon name="x" size={13} />
			</button>
		</div>

		<h2>{$_(`build.spec.${spec.titleKey}`, { values: spec.values })}</h2>
		<p class="blurb">{$_(`build.spec.${spec.blurbKey}`, { values: spec.values })}</p>

		<!-- keyed on the target so switching from one choice to another starts the next pane clean: a
		     card left open over the old option, or a search box still holding the old query, describes
		     something the pane is not about. -->
		{#key targetKey(target)}
			<div class="body scrolly" class:scrolls={ins.bodyScrolls}>
				{#if target.id === 'feat'}
					<FeatPane slotKey={target.slotKey} {ins} />
				{:else if spec.kind === 'pick'}
					<InspectorGrid {ins} />
				{:else}
					{@const Pane = PANE_COMPONENT[spec.pane]}
					<Pane />
				{/if}
			</div>
		{/key}

		<!-- No Take button: a click on a row commits it. What is left here is the way OUT, which a
		     reversible choice still needs and which nothing else offers. -->
		{#if ins.pick?.clearable && ins.pick.currentId}
			<footer class="foot">
				<button class="btn ghost" onclick={ins.clear}>{$_('build.inspector.clear')}</button>
			</footer>
		{/if}
	{/if}
</div>

<style>
	/* The pane owns the column's height and nothing above the body scrolls, so the wheel has exactly
	   one place to go wherever the pointer is (ui.md §1). */
	.pane {
		display: flex;
		flex-direction: column;
		gap: var(--space-2-5);
		height: 100%;
		min-height: 0;
	}
	.head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.spacer {
		flex: 1;
	}
	h2 {
		margin: 0;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-lg);
	}
	.blurb {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		line-height: 1.55;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2-5);
		flex: 1;
		min-height: 0;
	}
	/* the panes that are just content (abilities, skills, languages, notes) scroll here; a picker
	   builds its own region and leaves this one alone. */
	.body.scrolls {
		overflow: auto;
	}
	.resting {
		min-height: 0;
		overflow: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.resting.done {
		border-color: var(--color-good-line);
		background: var(--color-good-soft);
	}
	.eyebrow.ok {
		color: var(--color-good);
	}
	.todolist {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.todo {
		all: unset;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: var(--space-1-5);
		padding: var(--space-1-5) var(--space-2);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-xs);
		color: var(--color-accent-bright);
	}
	.todo:hover {
		background: var(--color-accent-soft);
	}
	.todo:focus-visible {
		outline: var(--focus-ring);
		outline-offset: -2px;
	}
	.todo.static {
		cursor: default;
		color: var(--color-text-muted);
	}
	/* the body takes every spare pixel, so the footer lands at the bottom on its own — nothing to be
	   sticky against, since the pane itself does not scroll */
	.foot {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex: none;
		border-top: 1px solid var(--color-border);
		padding: var(--space-2-5) 0;
	}
	.foot .btn {
		flex: none;
	}
</style>
