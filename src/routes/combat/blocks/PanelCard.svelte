<script lang="ts">
	import { rowGrid } from '#lib/actions/rowGrid.ts';
	/** What a row is in every panel: one line of the list, whatever its own markup. */
	const PANEL_ROWS = '.row-wrap, .effect-row, .resource-row, .inv-row, .spell-row, .skill-row';
	// One draggable card in the combat panel grid. `pid` selects which panel body it renders — skills /
	// attacks / actions / effects / spells / inventory — under a shared collapsible head (title + toolbar
	// button + drag handle). A thin dispatcher: each body lives in ./panels/*; character + sheet come in
	// as props. The dnd grid that hosts these cards stays in the page.
	import { tick } from 'svelte';
	import { provenance } from '#lib/actions/provenance.ts';
	import Icon from '#lib/components/Icon.svelte';
	import EyeIcon from '#lib/components/EyeIcon.svelte';
	import { resolve } from '$app/paths';
	import type { Character } from '#lib/character/schema.ts';
	import type { CharacterSheet } from '#lib/character/derive.ts';
	import { combat } from '../combat-view-model.svelte';
	import { PANEL_MOVE, type PanelMove } from '../panel-layout.svelte';
	import { dragHandle } from 'svelte-dnd-action';
	import { _ } from '#lib/i18n/index.ts';
	import PreparedCaps from '#lib/components/PreparedCaps.svelte';
	import SkillsPanel from './panels/SkillsPanel.svelte';
	import AttacksPanel from './panels/AttacksPanel.svelte';
	import ActionsPanel from './panels/ActionsPanel.svelte';
	import EffectsPanel from './panels/EffectsPanel.svelte';
	import SpellsPanel from './panels/SpellsPanel.svelte';
	import InventoryPanel from './panels/InventoryPanel.svelte';
	import FeaturesPanel from './panels/FeaturesPanel.svelte';

	// asTab: shown as one tab of a column (work/play-layout.md ▸ NARROW-DESKTOP). The tab names it, so
	// the title and its fold go, and a tab is not dragged; only the buttons of the panel itself stay.
	let {
		pid,
		c,
		s,
		asTab = false,
		compactSpells = false,
	}: {
		pid: string;
		c: Character;
		s: CharacterSheet;
		asTab?: boolean;
		compactSpells?: boolean;
	} = $props();
	const furniture = $derived(!asTab || combat.layout.arranging);

	// keyed on `e.code`, so it is the physical arrow key on every layout (AGENTS.md ▸ Taste)
	const ARROW_MOVE: Record<string, PanelMove> = {
		ArrowUp: PANEL_MOVE.up,
		ArrowDown: PANEL_MOVE.down,
		ArrowLeft: PANEL_MOVE.left,
		ArrowRight: PANEL_MOVE.right,
	};
	function moveOnArrow(event: KeyboardEvent): void {
		const dir = ARROW_MOVE[event.code];
		if (!dir) return;
		event.preventDefault(); // the page would scroll instead
		combat.layout.movePanel(pid, dir);
		// svelte-dnd-action rebuilds the column's nodes, so the button that had the caret is gone by
		// the time the move lands — a reorder must not cost the keyboard its place
		void tick().then(() => document.getElementById(`panel-grip-${pid}`)?.focus());
	}

	const collapsed = $derived(combat.layout.collapsed);
	const groupByLabel = $derived(combat.groupByLabel);
	const moveLabel = $derived(
		$_('combat.panel.moveHandle', { values: { panel: $_(`combat.panel.${pid}`) } }),
	);
	const { openMenu, cycleGroupBy } = combat;
	const autoCalcLabel = $derived(
		`${$_('combat.panel.autoCalc')} · ${$_(c.play.autoCalc ? 'combat.controls.on' : 'combat.controls.off')}`,
	);
	const { toggle } = combat.layout;
</script>

<div class="panel-head" class:as-tab={asTab}>
	{#if !asTab}
		<button
			class="htoggle"
			id={`panel-title-${pid}`}
			aria-expanded={!collapsed[pid]}
			onclick={() => toggle(pid)}
		>
			<span class="chevron"
				><Icon name={collapsed[pid] ? 'chevron-right' : 'chevron-down'} size={13} /></span
			>{$_(`combat.panel.${pid}`)}
		</button>
	{/if}
	{#if pid === 'actions' && furniture}
		<button class="pill-btn" onclick={(e) => openMenu('showhide', e)}>
			<EyeIcon on={true} />
			{$_('combat.panel.showHide')}
		</button>
	{:else if pid === 'effects'}
		<span class="head-btns">
			<!-- ONE button: a condition and a buff are the same content type and the same act, so two
			     "+"s beside each other were asking the player to know a distinction the data dropped -->

			<button class="pill-btn" onclick={(e) => openMenu('addstate', e)}>
				<Icon name="plus" size={13} />
				{$_('combat.panel.addState')}
			</button>

			<!-- Auto-calc lives HERE, not in the toolbar: switching it off drops the effect layers, and
			     this is the panel those layers are. It is an escape hatch for a number the engine got
			     wrong, so it stays out of sight until reached for. -->
			<button
				class="icon-button auto-calc"
				class:off={!c.play.autoCalc}
				aria-pressed={c.play.autoCalc}
				onclick={combat.effects.toggleAutoCalc}
				use:provenance={`${autoCalcLabel} — ${$_('combat.panel.autoCalcHint')}`}
				aria-label={autoCalcLabel}><Icon name="zap" size={13} /></button
			>
		</span>
	{:else if pid === 'features' && furniture}
		<button class="pill-btn" onclick={(e) => openMenu('featuresview', e)}>
			<EyeIcon on={true} />
			{$_('combat.panel.showHide')}
		</button>
	{:else if pid === 'inventory'}
		<button class="pill-btn" onclick={(e) => openMenu('coins', e)}>
			<Icon name="coins" size={13} />
			{$_('combat.panel.coins')}
		</button>
	{:else if pid === 'spells' && s.spellcasting.classes.length}
		<span class="prepared-count"><PreparedCaps tallies={combat.preparedTallies} /></span>

		<button
			class="pill-btn"
			onclick={cycleGroupBy}
			use:provenance={$_('combat.panel.changeGrouping')}
		>
			{$_(groupByLabel)}
			<Icon name="chevron-down" size={12} />
		</button>

		<!-- named for the view it opens, not for what you do there: `nav.spellbook` is that view's one
		     name, and a link that calls it something else is a second name for one place -->

		<a class="pill-btn" href={resolve('spellbook')}>
			<Icon name="book-open" size={13} />
			{$_('nav.spellbook')}
		</a>
	{/if}
	<!-- The grip. Armed by the library's own `dragHandle`, not by a flag of ours — which fixes three
	     things we had wrong at once. It `preventDefault()`s the press, so finishing a drag no longer
	     leaves behind a click that collapses the panel you just moved. It arms the zone through the
	     library's own store, which updates synchronously, where our flag updated on a microtask and so
	     landed after the very press it was meant to allow. And the zone releases it on `finalize`,
	     where our window `pointerup` raced the drop — which is why a drag could work once and then
	     stop.
	     NOT a <button>, either: the library discards a press whose target "is a nested input element",
	     and its test for that is `e.target.value !== undefined` — which every <button> passes, because
	     `HTMLButtonElement.value` is `""`. `dragHandle` sets `role="button"` and owns the tab stop; the
	     arrow keys, which move a panel without a pointer, stay ours. -->
	{#if !asTab}<span
			id="panel-grip-{pid}"
			class="drag-handle"
			use:dragHandle
			role="button"
			tabindex="0"
			aria-label={moveLabel}
			use:provenance={moveLabel}
			onkeydown={moveOnArrow}><Icon name="grip-vertical" size={15} /></span
		>{/if}
</div>
{#if asTab || !collapsed[pid]}
	<!-- the panel's rows are ONE Tab stop, walked by the arrows (work/ui.md ▸ KEYBOARD-NAV) -->
	<div class="panel-body" class:arranging={asTab && furniture} use:rowGrid={PANEL_ROWS}>
		{#if pid === 'skills'}
			<SkillsPanel {s} />
		{:else if pid === 'attacks'}
			<AttacksPanel {furniture} />
		{:else if pid === 'actions'}
			<ActionsPanel {furniture} />
		{:else if pid === 'effects'}
			<EffectsPanel {c} {s} />
		{:else if pid === 'spells'}
			<SpellsPanel {s} compact={compactSpells} {furniture} />
		{:else if pid === 'inventory'}
			<InventoryPanel {furniture} />
		{:else if pid === 'features'}
			<FeaturesPanel {furniture} />
		{/if}
	</div>
{/if}

<style>
	/* a wrapper for the keyboard, not for the layout: the panel lays itself out as it did */
	.panel-body {
		display: contents;
	}
	.panel-body.arranging {
		display: block;
		padding-inline-start: calc(var(--space-5) + var(--space-2));
		--row-grip-opacity: 1;
		--row-grip-width: var(--space-5);
		--row-grip-icon: grid;
		--row-grip-spine: none;
	}
	.head-btns {
		display: flex;
		gap: var(--space-1-5);
	}
	/* invisible until the head is under the pointer or the button itself takes focus — an everyday
	   button it is not. OFF keeps it visible and accented whatever the pointer does: an engine the
	   player switched off is a state they have to be able to SEE and undo. */
	.auto-calc {
		opacity: 0;
		transition: opacity 120ms ease;
	}
	.panel-head:hover .auto-calc,
	.auto-calc:focus-visible,
	.auto-calc.off {
		opacity: 1;
	}
	.auto-calc.off {
		color: var(--color-accent);
	}
	.prepared-count {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
</style>
