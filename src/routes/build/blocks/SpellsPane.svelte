<script lang="ts">
	// Spells, per caster class, with the caps that decide whether you're finished. Strict shows only
	// what this character may legally take; Free lifts every gate.
	//
	// It reads like the pick targets next door — the SAME OptionList and the SAME WikiDetail — because
	// the question is the same one: nothing is chosen blind. A wall of name-only chips was unusable
	// (fifty SRD spells, and no way to learn what any of them does without leaving the builder).
	//
	// A click TAKES the spell and opens its article; clicking it again gives it back. There is no
	// confirm step, because picking here is already reversible in one click — the Take footer next
	// door exists to let you read a diff first, and a spell has no diff to read.
	import { _ } from '$lib/i18n';
	import { build, rowName } from '../build-view-model.svelte';
	import { buildDetail } from '$lib/content/detail';
	import type { LoadedRow } from '$lib/content/loader';
	import { app } from '$lib/stores/app.svelte';
	import WikiDetail from '$lib/components/WikiDetail.svelte';
	import OptionList from './OptionList.svelte';
	const b = build;

	let query = $state('');
	/** The spell being READ. Shared across caster classes: one article at a time, like the pick panes. */
	let previewId = $state<string | null>(null);

	const match = (name: string) =>
		!query.trim() || name.toLowerCase().includes(query.trim().toLowerCase());
	const previewRow = $derived(previewId ? b.row(previewId) : undefined);
	const detail = $derived(
		previewRow ? buildDetail(previewRow, 'spell', undefined, app.activeLocale) : null,
	);

	const levelLabel = (level: number) =>
		level === 0
			? $_('build.spells.groupCantrips')
			: $_('build.spells.groupLevel', { values: { level } });
	/** Level → section label, for a list already sorted by level. */
	const groupOf = (row: LoadedRow) =>
		levelLabel(row.type === 'spell' ? Number(row.data.level ?? 0) : 0);
</script>

{#if b.spellPicker.length}
	{#each b.spellPicker as pc (pc.profile.classEffectiveId)}
		{@const options = pc.groups.flatMap((g) => g.spells).filter((s) => match(rowName(s)))}
		<div class="caster">
			<div class="card-head">
				<span class="eyebrow">{pc.profile.className}</span>
				<span class="spacer"></span>
				<span class="tag" class:accent={pc.cantripsChosen < pc.profile.cantripCap}>
					{$_('build.spells.cantrips', {
						values: { chosen: pc.cantripsChosen, cap: pc.profile.cantripCap }
					})}
				</span>
				<span class="tag" class:accent={pc.leveledChosen < pc.profile.preparedCap}>
					{$_(
						pc.profile.prepareStyle === 'known' ? 'build.spells.known' : 'build.spells.prepared',
						{ values: { chosen: pc.leveledChosen, cap: pc.profile.preparedCap } }
					)}
				</span>
			</div>

			<OptionList
				{options}
				bind:query
				{previewId}
				takenIds={b.draft.selectedSpells}
				onpreview={(id) => (previewId = id)}
				onactivate={b.toggleSpell}
				placeholder={$_('build.spells.search')}
				{groupOf}
			/>
		</div>
	{/each}

	{#if detail}
		<div class="article"><WikiDetail {detail} /></div>
	{:else}
		<p class="subtext">{$_('build.inspector.highlightToRead')}</p>
	{/if}
{:else if b.classRow}
	<p class="subtext">{$_('build.spells.noCasting', { values: { class: rowName(b.classRow) } })}</p>
{:else}
	<p class="subtext">{$_('build.spells.needClass')}</p>
{/if}

<style>
	.caster {
		display: flex;
		flex-direction: column;
		padding-top: 10px;
		border-top: 1px solid var(--color-border);
	}
	.caster:first-of-type {
		border-top: 0;
		padding-top: 0;
	}
</style>
