<script lang="ts">
	// The two big pickers — spells (658) and items (773). Their grouping key (spell level, item
	// category) is STRUCTURE, not a filter (ui.md §4): collapsible sticky sections, every header
	// always visible with its counts, everything collapsed by default. A filter that hides the rest
	// reads as being cut off from the list; a section does not, because nothing went anywhere.
	//
	// Reading and taking are separate controls (§6): the toggle on the left takes the row — the same
	// slot, and the same gold, as the spellbook's prepared switch and SkillRows' proficiency dot — and
	// the row body opens the article. Hover teases it (PickerPeek), a click reads it (PickerCard).
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import type { Snippet } from 'svelte';
	import type { LoadedRow } from '$lib/content/loader';
	import type { DetailModel } from '$lib/content/detail';
	import { filterByName, pickerMeta, rowName, rowText } from '../rows';
	import { PickerReading } from '../picker-reading.svelte';
	import PickerSearch from './PickerSearch.svelte';
	import PickerCard from './PickerCard.svelte';
	import PickerPeek from './PickerPeek.svelte';

	let {
		sections,
		query = $bindable(''),
		previewId,
		takenIds,
		onpreview,
		ontake,
		detail,
		placeholder,
		controls,
	}: {
		/** Pre-sorted; `key` is stable across a re-filter so an open section stays open. */
		sections: { key: string; label: string; rows: LoadedRow[] }[];
		query?: string;
		previewId: string | null;
		takenIds: string[];
		onpreview: (id: string) => void;
		ontake: (id: string) => void;
		detail: DetailModel | null;
		placeholder: string;
		/** Caps and filter chips — what narrows the pool genuinely, supplied by the pane that knows
		 *  which narrowing its content type has. */
		controls?: Snippet;
	} = $props();

	const taken = $derived(new Set(takenIds));
	let list = $state<HTMLElement | null>(null);
	let openKeys = $state<string[]>([]);
	/** The row the pointer or focus is teasing. Stands down entirely while the card is open. */
	let peeking = $state<string | null>(null);
	/** Which section headers the rail should light, recomputed on scroll (scroll-spy). */
	let hereKey = $state<string | null>(null);

	const trimmed = $derived(query.trim().toLowerCase());
	const shown = $derived(
		sections
			.map((s) => ({ ...s, rows: filterByName(s.rows, query) }))
			.filter((s) => !trimmed || s.rows.length),
	);
	/** A collapsed section must never hide a search match (§5), so typing forces everything open. */
	const isOpen = (key: string) => !!trimmed || openKeys.includes(key);
	/**
	 * Expand/collapse-all reads what the USER opened, not what the query forced open.
	 *
	 * Off the rendered state, any query made this true: the button read "Collapse all", clicking it
	 * changed nothing on screen — and threw away every section the user had opened, so clearing the
	 * query collapsed the lot.
	 */
	const allOpen = $derived(shown.length > 0 && shown.every((s) => openKeys.includes(s.key)));
	/** The rows the keyboard can reach — only what is actually rendered. */
	const walkable = $derived(shown.filter((s) => isOpen(s.key)).flatMap((s) => s.rows));
	const peekRow = $derived(walkable.find((r) => r.effectiveId === peeking));
	const previewRow = $derived(
		sections.flatMap((s) => s.rows).find((r) => r.effectiveId === previewId),
	);

	function toggleSection(key: string) {
		openKeys = openKeys.includes(key) ? openKeys.filter((k) => k !== key) : [...openKeys, key];
	}

	/**
	 * Scroll a section to the top of the list.
	 *
	 * Live rects, never `offsetTop` arithmetic: `offsetTop` is measured from each element's own
	 * `offsetParent`, so `header.offsetTop - list.offsetTop` only cancels while both resolve to the
	 * same ancestor — one `position: relative` wrapper between them breaks it silently. The first
	 * section snaps to a true 0, because the list's padding otherwise leaves a sliver above it that
	 * you can still scroll up past.
	 */
	const LIST_PAD_TOP = 8; // matches .rows padding-top
	function scrollToSection(key: string) {
		const box = list?.querySelector<HTMLElement>(`[data-section="${CSS.escape(key)}"]`);
		if (!list || !box) return;
		const first = key === shown[0]?.key;
		const top = first
			? 0
			: list.scrollTop + box.getBoundingClientRect().top - list.getBoundingClientRect().top - LIST_PAD_TOP;
		list.scrollTo({ top, behavior: 'smooth' });
	}

	function jumpTo(key: string) {
		if (!openKeys.includes(key)) openKeys = [...openKeys, key];
		// the section has to exist in the DOM before it can be scrolled to
		requestAnimationFrame(() => scrollToSection(key));
	}

	/**
	 * The rail says where you ARE; it never cuts the list down. A section is current once its header
	 * has reached the top of the list's viewport.
	 *
	 * Measured once per FRAME, not once per scroll event: a wheel fires far more often than the
	 * screen repaints, and this reads a rect per section — fourteen of them in the item picker — so
	 * unthrottled it asks the browser for layout many times over for one visible result.
	 */
	let spying = 0;
	function measure() {
		spying = 0;
		if (!list) return;
		const top = list.getBoundingClientRect().top;
		let current: string | null = null;
		for (const box of list.querySelectorAll<HTMLElement>('[data-section]'))
			if (box.getBoundingClientRect().top - top <= LIST_PAD_TOP + 2)
				current = box.dataset.section ?? null;
		hereKey = current;
	}
	function spy() {
		if (!spying) spying = requestAnimationFrame(measure);
	}

	// reading + the keyboard walk are the same contract in both pickers — see `picker-reading`.
	// The id scopes this picker's DOM ids: the spell pane renders one per caster class.
	const pickerId = $props.id();
	const picker = new PickerReading(
		() => ({
			ids: walkable.map((r) => r.effectiveId),
			previewId,
			onpreview,
			ontake,
			onopen: () => (peeking = null), // the teaser steps aside for the real thing
		}),
		pickerId,
	);
</script>

<PickerSearch
	bind:query
	bind:element={picker.search}
	{placeholder}
	count={shown.reduce((n, s) => n + s.rows.length, 0)}
	onkeydown={picker.fromSearch}
	listId={picker.listId}
	activeId={picker.activeId}
/>

{#if controls}{@render controls()}{/if}

<div class="jump">
	{#each shown as section (section.key)}
		{@const got = section.rows.filter((r) => taken.has(r.effectiveId)).length}
		<button class="jumpbtn" class:here={section.key === hereKey} onclick={() => jumpTo(section.key)}>
			{section.label}{#if got}<span class="gold"> {got}</span>{/if}
		</button>
	{/each}
	<button
		class="jumpbtn all"
		onclick={() => (openKeys = allOpen ? [] : shown.map((s) => s.key))}
	>
		{$_(allOpen ? 'build.picker.collapseAll' : 'build.picker.expandAll')}
	</button>
</div>

<div
	class="rows scrolly"
	id={picker.listId}
	role="listbox"
	tabindex="-1"
	aria-label={$_('build.inspector.options')}
	bind:this={list}
	onkeydown={picker.fromOptions}
	onscroll={spy}
>
	{#each shown as section (section.key)}
		{@const open = isOpen(section.key)}
		{@const got = section.rows.filter((r) => taken.has(r.effectiveId)).length}
		<button
			class="sect"
			class:shut={!open}
			data-section={section.key}
			aria-expanded={open}
			onclick={() => toggleSection(section.key)}
		>
			<Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
			<span class="sname">{section.label}</span>
			<span class="sof">
				{#if got}<span class="gold">{$_('build.picker.sectionTaken', { values: { count: got } })}</span> ·
				{/if}{section.rows.length}
			</span>
		</button>
		{#if open}
			{#each section.rows as row (row.effectiveId)}
				{@const id = row.effectiveId}
				{@const on = taken.has(id)}
				{@const name = rowName(row)}
				<!-- presentational: a listbox's children are options, and this is the row's layout box -->
					<div
						class="srow"
						role="presentation"
						class:is-taken={on}
						class:is-active={id === previewId}
						data-entry={id}
					>
					<button
						class="addbtn"
						class:on
						aria-pressed={on}
						aria-label={$_(on ? 'build.picker.removeRow' : 'build.picker.takeRow', {
							values: { name },
						})}
						onclick={() => ontake(id)}
					>
						<Icon name="check" size={12} />
					</button>
					<!-- a double-click is the shortcut to the toggle beside it: the hand is already on the
					     row, and the ✓ is a small target to travel to for something you do dozens of
					     times. It commits nothing a single click does, so reading stays free. -->
					<button
						class="sbody"
						id={picker.optionId(id)}
						role="option"
						aria-selected={on}
						onclick={(event) => event.detail < 2 && picker.read(id)}
						ondblclick={() => {
							ontake(id);
							picker.close();
						}}
						onmouseenter={() => (peeking = id)}
						onmouseleave={() => (peeking = null)}
						onfocus={() => (peeking = id)}
						onblur={() => (peeking = null)}
					>
						<b>{name}</b>
						<span class="smeta">{pickerMeta(row, $_)}</span>
					</button>
				</div>
			{/each}
		{/if}
	{:else}
		<p class="subtext nomatch">{$_('build.inspector.noMatch', { values: { query } })}</p>
	{/each}
</div>

{#if picker.reading && list && previewId && previewRow}
	<PickerCard
		picker={list}
		entryId={previewId}
		title={rowName(previewRow)}
		{detail}
		taken={taken.has(previewId)}
		ontake={() => ontake(previewId)}
		onclose={picker.close}
	/>
{:else if peeking && list && peekRow}
	<PickerPeek
		picker={list}
		entryId={peeking}
		title={rowName(peekRow)}
		meta={pickerMeta(peekRow, $_)}
		text={rowText(peekRow)}
		hint={$_('build.picker.readOrTake')}
	/>
{/if}

<style>
	/* the jump rail: opens a section and scrolls to it, and lights itself as you scroll past. Same
	   navigation as the headers, at a density that survives everything being open. */
	.jump {
		display: flex;
		gap: var(--space-1);
		margin-top: var(--space-2);
		flex: none;
		overflow-x: auto;
		padding-bottom: 2px;
		scrollbar-width: thin;
	}
	.jumpbtn {
		all: unset;
		box-sizing: border-box;
		cursor: pointer;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-full);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text-muted);
	}
	.jumpbtn:hover {
		border-color: var(--color-border-strong);
		color: var(--color-text);
	}
	.jumpbtn:focus-visible {
		outline: var(--focus-ring);
		outline-offset: 1px;
	}
	.jumpbtn.here {
		border-color: var(--color-accent);
		background: var(--color-accent-soft);
		color: var(--color-accent-bright);
	}
	/* pinned to the right edge of the rail: with fourteen item categories the rail scrolls, and the one
	   control that acts on ALL of them must not be the one that scrolls out of reach */
	.jumpbtn.all {
		position: sticky;
		inset-inline-end: 0;
		margin-inline-start: auto;
		background: var(--color-bg);
		box-shadow: -8px 0 8px -4px var(--color-bg);
	}

	/* the ONE scroll region in the pane */
	.rows {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: var(--space-2) 2px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		margin-top: var(--space-2);
	}
	.nomatch {
		margin: var(--space-1) var(--space-2);
	}

	.sect {
		all: unset;
		box-sizing: border-box;
		position: sticky;
		top: -8px;
		z-index: 3;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-1-5) var(--space-2-5);
		margin: var(--space-1-5) 0 2px;
		border-radius: var(--radius);
		cursor: pointer;
		background: var(--color-bg);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.sect:first-child {
		margin-top: 0;
	}
	.sect:hover {
		background: var(--color-surface-2);
	}
	.sect:focus-visible {
		outline: var(--focus-ring);
		outline-offset: -2px;
	}
	.sname {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
		color: var(--color-text);
	}
	.sect.shut .sname {
		color: var(--color-text-muted);
	}
	.sof {
		margin-inline-start: auto;
		font-size: var(--font-size-micro);
	}
	/* a row is TWO controls: the state toggle on the left, the body that reads. The wrapper carries
	   the state so both halves are inside the same lit box. */
	.srow {
		display: flex;
		align-items: stretch;
		gap: var(--space-1);
		margin: 0 var(--space-1-5);
		border: 1px solid transparent;
		border-radius: var(--radius);
	}
	/* the state fills are `.is-active` / `.is-taken` in build.css; hover borrows the active look
	   because pointing at a row and reading it are the same intent a moment apart */
	.srow:hover {
		border-color: var(--color-accent);
		background: var(--color-accent-soft);
	}
	/* the control itself is `.addbtn` in build.css — shared with the feat pane's ASI row, which asks
	   the same question. Where it sits in THIS row is what stays here. */
	.srow .addbtn {
		margin-inline-start: var(--space-1-5);
	}
	.sbody {
		all: unset;
		box-sizing: border-box;
		cursor: pointer;
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		padding: var(--space-1-5) var(--space-2-5) var(--space-1-5) 2px;
		border-radius: var(--radius);
		/* `all: unset` puts text selection back, and the row's second click is a double-click that
		   takes the spell — highlighting its name on the way is not what that gesture meant */
		user-select: none;
	}
	.sbody:focus-visible {
		outline: var(--focus-ring);
		outline-offset: -2px;
	}
	.sbody b {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.smeta {
		flex: 1;
		text-align: end;
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
