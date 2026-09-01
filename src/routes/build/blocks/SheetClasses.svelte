<script lang="ts">
	// Class, subclass, level — and everything those levels actually handed over. A character is not
	// necessarily built at level 1, so the feature list is the proof: every level up to this one is
	// listed, plus the next few, so nothing arrives unexplained and nothing is silently skipped.
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import { build, rowName, rowOfType } from '../build-view-model.svelte';
	import { rowDetail, rowText, savesLabel } from '../rows';
	import { classFeatureLines } from '$lib/build/derive';
	import PickerCard from './PickerCard.svelte';
	const b = build;

	const features = $derived(
		b.graph
			? classFeatureLines({
					classes: b.draft.classes,
					graph: b.graph,
					system: b.draft.system,
					nameOf: (r) => rowName(r)
				})
			: []
	);
	const gained = $derived(features.filter((f) => f.gained));
	const upcoming = $derived(features.filter((f) => !f.gained));

	/** Multiclass features are two lists that happen to share a sheet, not one list: a Wizard's
	 *  Spellcasting and a Cleric's Spellcasting are different features with the same name, and
	 *  interleaving them by level makes neither readable. Single-class collapses to one group with
	 *  no heading, so nothing is added for the common case. */
	const byClass = $derived.by(() => {
		const groups = new Map<string, typeof features>();
		for (const f of features) groups.set(f.className, [...(groups.get(f.className) ?? []), f]);
		return [...groups].map(([className, lines]) => ({
			className,
			gained: lines.filter((f) => f.gained),
			upcoming: lines.filter((f) => !f.gained)
		}));
	});
	const multi = $derived(byClass.length > 1);

	/** A feature's prose is clamped to two lines here, so clicking one opens the rest — the same
	 *  article card the pickers use, because this is the same act of reading a content row. */
	let card = $state<HTMLElement | null>(null);
	let readingId = $state<string | null>(null);
	const readingRow = $derived(features.find((f) => f.row.effectiveId === readingId)?.row);
	const detail = $derived(rowDetail(readingRow, 'class_feature'));
	const readFeature = (id: string) => (readingId = readingId === id ? null : id);
</script>

<div class="card" bind:this={card}>
	<div class="card-head">
		<span class="eyebrow">{$_('build.classes.title')}</span>
		<span class="spacer"></span>
		<span class="trail">{$_('build.classes.featureCount', { values: { count: gained.length } })}</span>
		<button class="pill-btn" onclick={() => b.addClass()} disabled={!b.canRaiseLevel}>
			<Icon name="plus" size={12} /> {$_('build.classes.multiclass')}
		</button>
	</div>

	{#each b.draft.classes as cls, i (cls.rowId)}
		{@const clsRow = rowOfType(b.row(cls.classId), 'class')}
		{@const subs = b.subclassesFor(cls.classId)}
		{@const subRow = rowOfType(b.row(cls.subclassId), 'subclass')}
		{@const subDue = Number(clsRow?.data.subclass_level ?? 0)}
		{@const named = { values: { name: rowName(clsRow) || $_('build.classes.classWord') } }}
		<div class="classrow">
			<button
				class="slot pickbtn"
				class:empty={!clsRow}
				class:active={b.inspector.isOpen({ id: 'class', index: i })}
				onclick={() => b.inspector.toggle({ id: 'class', index: i })}
			>
				<b
					>{clsRow
						? rowName(clsRow)
						: $_(i === 0 ? 'build.classes.chooseClass' : 'build.classes.chooseAnotherClass')}</b
				>
				<small
					>{clsRow
						? $_('build.classes.classMeta', {
								values: {
									die: String(clsRow.data.hit_die),
									saves: savesLabel(clsRow.data.saves)
								}
							})
						: $_('build.classes.classHint')}</small
				>
			</button>

			{#if subs.length}
				<button
					class="slot pickbtn sub"
					class:empty={!subRow && subDue > 0 && cls.level >= subDue}
					class:active={b.inspector.isOpen({ id: 'subclass', index: i })}
					onclick={() => b.inspector.toggle({ id: 'subclass', index: i })}
				>
					<b>{subRow ? rowName(subRow) : $_('build.classes.subclass')}</b>
					<small
						>{subRow
							? $_('build.classes.subclassChosen')
							: $_(
									cls.level >= subDue
										? 'build.classes.subclassDue'
										: 'build.classes.subclassOpens',
									{ values: { level: subDue } }
								)}</small
					>
				</button>
			{/if}

			<span class="stepper level">
				<button aria-label={$_('build.classes.lowerLevel', named)} onclick={() => b.bumpClassLevel(i, -1)}><Icon name="minus" size={12} /></button>
				<span class="base">{cls.level}</span>
				<button aria-label={$_('build.classes.raiseLevel', named)} onclick={() => b.bumpClassLevel(i, 1)} disabled={!b.canRaiseLevel}><Icon name="plus" size={12} /></button>
			</span>
			{#if i > 0}
				<button class="icon-button" title={$_('build.classes.removeClass')} aria-label={$_('build.classes.removeClass')} onclick={() => b.removeClass(i)}><Icon name="x" size={12} /></button>
			{/if}
		</div>
	{/each}

	{#snippet featureGrid(gainedLines: typeof features, upcomingLines: typeof features)}
		<div class="features">
			{#each gainedLines as f (`${f.className}:${f.row.effectiveId}:${f.level}`)}
				{@const prose = rowText(f.row)}
				<button
					class="feature readable"
					class:reading={f.row.effectiveId === readingId}
					data-entry={f.row.effectiveId}
					title={$_('build.picker.readMore')}
					onclick={() => readFeature(f.row.effectiveId)}
				>
					<span class="lvl" class:sub={f.fromSubclass}>{f.level}</span>
					<div class="ftext">
						<b>{rowName(f.row)}</b>
						{#if prose}<span class="clamp-2">{prose}</span>{/if}
					</div>
				</button>
			{/each}
			{#each upcomingLines as f (`${f.className}:${f.row.effectiveId}:${f.level}`)}
				<div class="feature ahead">
					<span class="lvl">{f.level}</span>
					<div class="ftext">
						<b>{rowName(f.row)}</b>
						<span class="clamp-2"
							>{$_(
								f.fromSubclass ? 'build.classes.arrivesFromSubclass' : 'build.classes.arrives',
								{ values: { level: f.level } }
							)}</span
						>
					</div>
				</div>
			{/each}
		</div>
	{/snippet}

	{#if features.length}
		{#if multi}
			{#each byClass as g (g.className)}
				<div class="clsgroup">
					<div class="clslabel">
						<span class="eyebrow">{g.className}</span>
						<span class="trail"
							>{$_('build.classes.featureCount', { values: { count: g.gained.length } })}</span
						>
					</div>
					{@render featureGrid(g.gained, g.upcoming)}
				</div>
			{/each}
		{:else}
			{@render featureGrid(gained, upcoming)}
		{/if}
	{/if}
</div>

{#if readingId && card && readingRow}
	<PickerCard
		picker={card}
		entryId={readingId}
		title={rowName(readingRow)}
		{detail}
		taken={false}
		onclose={() => (readingId = null)}
	/>
{/if}

<style>
	.classrow {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 7px 0;
		border-top: 1px solid var(--color-border);
	}
	.classrow:first-of-type {
		border-top: 0;
		padding-top: 0;
	}
	.pickbtn {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 7px 10px;
		border-color: var(--color-border);
		background: var(--color-surface-2);
	}
	.pickbtn.sub {
		flex: 0 1 190px;
	}
	.pickbtn b {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pickbtn small {
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
	.features {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 4px 16px;
		margin-top: 11px;
		padding-top: 11px;
		border-top: 1px solid var(--color-border);
	}
	/* one block per class, so two Spellcastings never sit side by side unlabelled */
	.clsgroup + .clsgroup {
		margin-top: 6px;
	}
	.clslabel {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-top: 11px;
		padding-top: 11px;
		border-top: 1px solid var(--color-border);
	}
	.clsgroup .features {
		margin-top: 4px;
		padding-top: 0;
		border-top: 0;
	}
	.feature {
		display: flex;
		gap: 9px;
		align-items: flex-start;
		padding: 4px 0;
	}
	/* a gained feature is two clamped lines, so it says so and opens the rest */
	.feature.readable {
		all: unset;
		box-sizing: border-box;
		display: flex;
		gap: 9px;
		align-items: flex-start;
		width: 100%;
		padding: 4px 6px;
		margin: 0 -6px;
		border-radius: var(--radius-sm);
		cursor: pointer;
		text-align: left;
	}
	.feature.readable:hover {
		background: var(--color-surface-2);
	}
	.feature.readable:focus-visible {
		outline: var(--focus-ring);
		outline-offset: -2px;
	}
	.feature.reading {
		background: var(--color-accent-soft);
	}
	.feature.reading b {
		color: var(--color-accent-bright);
	}
	.feature.ahead {
		opacity: 0.55;
	}
	/* the badge itself is `.lvl` in build.css; this row makes it a fixed, centred column */
	.lvl {
		min-width: 20px;
		text-align: center;
	}
	.lvl.sub {
		border-color: var(--color-accent-deep);
		color: var(--color-accent-bright);
	}
</style>
