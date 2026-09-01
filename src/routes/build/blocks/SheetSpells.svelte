<script lang="ts">
	// Spellcasting as the sheet shows it: the slot pools this level opened, then the chosen spells
	// grouped by level. Slots that a higher level will open are shown too, dimmed — a character built
	// straight to level 5 should be able to see what level 9 is holding.
	import { _ } from '$lib/i18n';
	import { build, rowName, rowOfType } from '../build-view-model.svelte';
	const b = build;

	const s = $derived(b.sheet);
	const casting = $derived(s?.spellcasting);

	/** The chosen spells, bucketed by their own level. Cantrips lead. */
	const byLevel = $derived.by(() => {
		const buckets = new Map<number, { id: string; name: string }[]>();
		for (const ref of b.draft.selectedSpells) {
			const row = rowOfType(b.row(ref), 'spell');
			const lvl = Number(row?.data.level ?? 0);
			const bucket = buckets.get(lvl) ?? [];
			bucket.push({ id: ref, name: rowName(row) || ref });
			buckets.set(lvl, bucket);
		}
		return [...buckets.entries()]
			.sort(([a], [c]) => a - c)
			.map(([level, spells]) => ({
				level,
				spells: spells.sort((x, y) => x.name.localeCompare(y.name))
			}));
	});

	const open = () => b.inspector.toggle({ id: 'spells' });
</script>

{#if b.spellPicks.isCaster && casting}
	<div class="card">
		<div class="card-head">
			<span class="eyebrow">{$_('build.spells.title')}</span>
			<span class="spacer"></span>
			{#each casting.classes as c (c.classEffectiveId)}
				<span class="trail"
					>{$_('build.spells.casterMeta', {
						values: {
							class: c.className,
							ability: c.ability.toUpperCase(),
							style: $_(
								c.prepareStyle === 'known'
									? 'build.spells.styleKnown'
									: 'build.spells.stylePrepared'
							),
							chosen:
								b.spellPicks.picker.find((p) => p.profile.classEffectiveId === c.classEffectiveId)
									?.leveledChosen ?? 0,
							cap: c.preparedCap
						}
					})}</span
				>
			{/each}
			<button class="pill-btn" class:accent={b.inspector.isOpen({ id: 'spells' })} onclick={open}>
				{$_('build.spells.choose')}
			</button>
		</div>

		{#if casting.armorBlock}
			<p class="subtext warn">
				{$_('build.spells.armorBlock', {
					values: { note: casting.armorBlock.note, source: casting.armorBlock.source }
				})}
			</p>
		{/if}

		<div class="slots">
			<span class="eyebrow">{$_('build.spells.slots')}</span>
			{#each casting.pools as pool (pool.id)}
				<span class="tag gold">
					{pool.label}
					<b>{pool.max}</b>
				</span>
			{/each}
			{#if !casting.pools.length}
				<span class="tag ghost">{$_('build.spells.noSlots')}</span>
			{/if}
			{#if casting.ritualCasting}<span class="tag muted">{$_('build.spells.rituals')}</span>{/if}
		</div>

		{#if byLevel.length}
			<div class="groups">
				{#each byLevel as g (g.level)}
					<div class="group">
						<div class="sectlab">
							<span
								>{g.level === 0
									? $_('build.spells.groupCantrips')
									: $_('build.spells.groupLevel', { values: { level: g.level } })}</span
							>
						</div>
						<div class="chips">
							{#each g.spells as sp (sp.id)}
								<button
									class="pick-chip on"
									title={$_('build.spells.remove', { values: { name: sp.name } })}
									onclick={() => b.spellPicks.toggle(sp.id)}
								>
									{sp.name}
								</button>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<p class="subtext">{$_('build.spells.noneChosen')}</p>
		{/if}
	</div>
{:else if b.primaryClassId}
	<div class="card quiet">
		<span class="eyebrow">{$_('build.spells.title')}</span>
		<p class="subtext">{$_('build.spells.noCasting', { values: { class: rowName(b.classRow) } })}</p>
	</div>
{/if}

<style>
	.slots {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1-5);
		margin-bottom: var(--space-3);
	}
	.groups {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: var(--space-2-5) var(--space-4);
	}
	.group .sectlab {
		margin-bottom: var(--space-1-5);
	}
	.quiet {
		padding: var(--space-3) 17px;
	}
	.quiet .subtext {
		margin: var(--space-1) 0 0;
	}
</style>
