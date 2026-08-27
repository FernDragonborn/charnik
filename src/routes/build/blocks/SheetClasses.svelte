<script lang="ts">
	// Class, subclass, level — and everything those levels actually handed over. A character is not
	// necessarily built at level 1, so the feature list is the proof: every level up to this one is
	// listed, plus the next few, so nothing arrives unexplained and nothing is silently skipped.
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import { build, rowName, rowOfType } from '../build-view-model.svelte';
	import { rowText } from '../rows';
	import { classFeatureLines } from '$lib/build/derive';
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
</script>

<div class="card">
	<div class="card-head">
		<span class="eyebrow">{$_('build.classes.title')}</span>
		<span class="spacer"></span>
		<span class="trail">{$_('build.classes.featureCount', { values: { count: gained.length } })}</span>
		<button class="pill-btn" onclick={() => b.addClass()} disabled={!b.canRaiseLevel}>
			<Icon name="plus" size={12} /> {$_('build.classes.multiclass')}
		</button>
	</div>

	{#each b.draft.classes as cls, i (i)}
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
									saves: String(clsRow.data.saves).toUpperCase()
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

	{#if features.length}
		<div class="features">
			{#each gained as f (`${f.className}:${f.row.effectiveId}:${f.level}`)}
				{@const prose = rowText(f.row)}
				<div class="feature">
					<span class="lvl" class:sub={f.fromSubclass}>{f.level}</span>
					<div class="ftext">
						<b>{rowName(f.row)}</b>
						{#if prose}<span class="clamp-2">{prose}</span>{/if}
					</div>
				</div>
			{/each}
			{#each upcoming as f (`${f.className}:${f.row.effectiveId}:${f.level}`)}
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
	{/if}
</div>

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
	.feature {
		display: flex;
		gap: 9px;
		align-items: flex-start;
		padding: 4px 0;
	}
	.feature.ahead {
		opacity: 0.55;
	}
	.lvl {
		flex: none;
		min-width: 20px;
		text-align: center;
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		border-radius: 5px;
		padding: 2px 0;
	}
	.lvl.sub {
		border-color: var(--color-accent-deep);
		color: var(--color-accent-bright);
	}
	.ftext {
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.ftext b {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
</style>
