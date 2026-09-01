<script lang="ts">
	// Origin — species (+ its lineage) and background, side by side. Each is a `.slot`: filled it
	// shows what the choice actually gave, empty it shows what it WILL give and reads crimson,
	// because an empty origin is the most common reason a draft can't be saved.
	import { _ } from '$lib/i18n';
	import { build, rowName } from '../build-view-model.svelte';
	import { skillLabel } from '../rows';
	import { splitList } from '$lib/content/schemas';
	import { titleCase } from '$lib/util/format';
	import { metres } from '$lib/combat/constants';
	import type { InspectorTarget } from '../inspector.svelte';
	const b = build;

	const species = $derived(b.speciesRow);
	const lineage = $derived(b.speciesOptionRow);
	const background = $derived(b.backgroundRow);

	const bgSkills = $derived(splitList(background?.data.skills).map((s) => skillLabel(s, $_)));
	const bgTools = $derived(splitList(background?.data.tools).map((t) => titleCase(t)));
	const bgBoosts = $derived(splitList(background?.data.ability_choices).map((a) => a.toUpperCase()));

	const open = (target: InspectorTarget) => b.inspector.toggle(target);
</script>

<div class="card origin">
	<div class="pair">
		<button
			class="slot block"
			class:empty={!species}
			class:active={b.inspector.isOpen({ id: 'species' })}
			onclick={() => open({ id: 'species' })}
		>
			<span class="eyebrow">{$_('build.origin.species')}</span>
			{#if species}
				<b class="pickname">{rowName(species)}</b>
				<span class="mini">
					{$_('build.origin.speciesMeta', {
						values: {
							size: titleCase(String(species.data.size)),
							feet: Number(species.data.speed),
							metres: metres(Number(species.data.speed))
						}
					})}{#if species.data.creature_type}{' · ' + titleCase(String(species.data.creature_type))}{/if}
				</span>
			{:else}
				<b class="pickname">{$_('build.notChosen')}</b>
				<span class="mini">{$_('build.origin.speciesHint')}</span>
			{/if}
		</button>

		{#if b.speciesOptions.length}
			<button
				class="slot block"
				class:empty={!lineage}
				class:active={b.inspector.isOpen({ id: 'speciesOption' })}
				onclick={() => open({ id: 'speciesOption' })}
			>
				<span class="eyebrow">{b.speciesOptionLabel}</span>
				<b class="pickname">{lineage ? rowName(lineage) : $_('build.notChosen')}</b>
				<span class="mini"
					>{$_(lineage ? 'build.origin.lineageChosen' : 'build.origin.lineageAsk', {
						values: { species: rowName(species) }
					})}</span
				>
			</button>
		{/if}

		<button
			class="slot block"
			class:empty={!background}
			class:active={b.inspector.isOpen({ id: 'background' })}
			onclick={() => open({ id: 'background' })}
		>
			<span class="eyebrow">{$_('build.origin.background')}</span>
			{#if background}
				<b class="pickname">{rowName(background)}</b>
				<span class="chips tags">
					{#each bgSkills as s (s)}<span class="tag gold">{s}</span>{/each}
					{#each bgTools as t (t)}<span class="tag muted">{t}</span>{/each}
					{#if Number(background.data.languages) > 0}
						<span class="tag muted"
							>{$_('build.origin.backgroundLanguages', {
								values: { count: Number(background.data.languages) }
							})}</span
						>
					{/if}
					{#each bgBoosts as a (a)}<span class="tag gold">{a}</span>{/each}
				</span>
			{:else}
				<b class="pickname">{$_('build.notChosen')}</b>
				<span class="chips tags">
					<!-- what a background gives is data, so an unchosen one promises nothing countable: two
					     skills is the SRD's usual shape, not a rule, and a number here would be inventing
					     game data on a card that has none yet -->
					<span class="tag ghost">{$_('build.origin.backgroundSkillsUnknown')}</span>
					<span class="tag ghost">{$_('build.origin.backgroundTool')}</span>
					<span class="tag ghost wanted">{$_('build.origin.backgroundBoosts')}</span>
				</span>
			{/if}
		</button>
	</div>
</div>

<style>
	.pair {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: var(--space-2-5);
		align-items: stretch;
	}
	.slot.block {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2-5) var(--space-3);
		border-color: var(--color-border);
		background: var(--color-surface-2);
	}
	.pickname {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-md);
	}
	.mini {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		line-height: 1.45;
	}
	/* layout is the global .chips; what stays here is where this one sits */
	.tags {
		margin-top: 2px;
	}
</style>
