<script lang="ts">
	// The right pane. A shared shell — eyebrow, title, one sentence of what this choice IS, then a
	// body, then a footer that commits — around a body component chosen per target, because a feat
	// slot and a notes field are not the same question and forcing them into one layout makes both
	// worse. Every target is rendered side by side at /dev/inspector.
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import { build, rowName } from '../build-view-model.svelte';
	import type { Inspector } from '../inspector.svelte';
	import PickPane from './PickPane.svelte';
	import FeatPane from './FeatPane.svelte';
	import AbilitiesPane from './AbilitiesPane.svelte';
	import SkillsPane from './SkillsPane.svelte';
	import LanguagesPane from './LanguagesPane.svelte';
	import SpellsPane from './SpellsPane.svelte';
	import InventoryPane from './InventoryPane.svelte';
	import NotesPane from './NotesPane.svelte';
	const b = build;
	// defaults to the page's shared inspector; /dev/inspector passes its own so it can show every
	// target at once, each previewing against the same draft.
	let { inspector = build.inspector }: { inspector?: Inspector } = $props();
	const ins = $derived(inspector);

	const spec = $derived(ins.spec);
	const target = $derived(ins.target);
	/** What the Take button would commit — named, so the button says what happens. */
	const previewName = $derived(
		ins.previewId === null
			? ''
			: ins.previewRow
				? rowName(ins.previewRow)
				: $_('build.feats.asi')
	);
</script>

<div class="pane">
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

		<div class="body">
			{#if target.id === 'feat'}
				<FeatPane slotKey={target.slotKey} {ins} />
			{:else if spec.kind === 'pick'}
				<PickPane {ins} />
			{:else if spec.pane === 'abilities'}
				<AbilitiesPane />
			{:else if spec.pane === 'skills'}
				<SkillsPane />
			{:else if spec.pane === 'languages'}
				<LanguagesPane />
			{:else if spec.pane === 'spells'}
				<SpellsPane />
			{:else if spec.pane === 'inventory'}
				<InventoryPane />
			{:else if spec.pane === 'notes'}
				<NotesPane />
			{/if}
		</div>

		{#if ins.pick}
			<footer class="foot">
				{#if ins.pick.clearable && ins.pick.currentId}
					<button class="btn ghost" onclick={ins.clear}>{$_('build.inspector.clear')}</button>
				{/if}
				<span class="spacer"></span>
				<button class="btn primary" disabled={ins.previewId === null || ins.previewIsCurrent} onclick={ins.take}>
					{ins.previewIsCurrent && ins.pick.currentId
						? $_('build.inspector.alreadyTaken')
						: previewName
							? $_('build.inspector.take', { values: { name: previewName } })
							: $_('build.inspector.chooseOption')}
				</button>
			</footer>
		{/if}
	{/if}
</div>

<style>
	.pane {
		display: flex;
		flex-direction: column;
		gap: 11px;
		min-height: 100%;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
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
		gap: 11px;
	}
	.resting {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		padding: 13px;
		display: flex;
		flex-direction: column;
		gap: 9px;
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
		gap: 3px;
	}
	.todo {
		all: unset;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 8px;
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
	.foot {
		display: flex;
		align-items: center;
		gap: 9px;
		margin-top: auto;
		position: sticky;
		bottom: 0;
		background: var(--color-bg);
		border-top: 1px solid var(--color-border);
		padding: 11px 0;
	}
	.foot .btn {
		flex: none;
	}
</style>
