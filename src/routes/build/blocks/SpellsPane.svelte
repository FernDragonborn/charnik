<script lang="ts">
	// Spells, per caster class, with the caps that decide whether you're finished. Strict shows only
	// what this character may legally take; Free lifts every gate.
	//
	// Level is the list's STRUCTURE, not a filter (ui.md §4): you never choose "out of all 300", you
	// choose "two of third level". Sections start collapsed, so the whole shape of the list fits one
	// screen with no scroll and the level you want is one click away. School / concentration / ritual
	// stay real filter chips, because those genuinely narrow.
	//
	// The caps are per CLASS, not per level — `cantripCap` + `preparedCap` — so they live in the head
	// here. A per-level "2/3" counter would be invented game data.
	import { _ } from '$lib/i18n';
	import { build, rowName } from '../build-view-model.svelte';
	import type { LoadedRow } from '$lib/content/loader';
	import { titleCase } from '$lib/util/format';
	import { rowDetail } from '../rows';
	import SectionedPicker from './SectionedPicker.svelte';
	const b = build;

	let query = $state('');
	/** The spell being READ. Shared across caster classes: one article at a time, like the pick panes. */
	let previewId = $state<string | null>(null);
	/** Facets. Schools are OR within themselves (an empty set means "any"); the two flags are AND. */
	let schools = $state<string[]>([]);
	let concentrationOnly = $state(false);
	let ritualOnly = $state(false);

	const detail = $derived(rowDetail(previewId ? b.row(previewId) : undefined, 'spell'));

	const levelLabel = (level: number) =>
		level === 0
			? $_('build.spells.groupCantrips')
			: $_('build.spells.groupLevel', { values: { level } });

	/** The schools actually present in this character's pool — discovered, never a hardcoded list, so
	 *  a homebrew pack that ships a tenth school gets a chip for it. */
	const schoolsPresent = $derived([
		...new Set(
			b.spellPicks.picker
				.flatMap((pc) => pc.groups.flatMap((g) => g.spells))
				.map((s) => (s.type === 'spell' ? String(s.data.school) : ''))
				.filter(Boolean),
		),
	].sort());

	function passesFacets(row: LoadedRow): boolean {
		if (row.type !== 'spell') return true;
		if (schools.length && !schools.includes(String(row.data.school))) return false;
		if (concentrationOnly && !row.data.concentration) return false;
		if (ritualOnly && !row.data.ritual) return false;
		return true;
	}
	const toggleSchool = (school: string) =>
		(schools = schools.includes(school) ? schools.filter((s) => s !== school) : [...schools, school]);
</script>

{#if b.spellPicks.picker.length}
	{#each b.spellPicks.picker as pc (pc.profile.classEffectiveId)}
		{@const sections = pc.groups
			.map((g) => ({
				key: `${pc.profile.classEffectiveId}:${g.level}`,
				label: levelLabel(g.level),
				rows: g.spells.filter(passesFacets),
			}))
			.filter((s) => s.rows.length)}
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

			<SectionedPicker
				{sections}
				bind:query
				{previewId}
				takenIds={b.draft.selectedSpells}
				onpreview={(id) => (previewId = id)}
				ontake={b.spellPicks.toggle}
				{detail}
				placeholder={$_('build.spells.search')}
			>
				{#snippet controls()}
					<div class="chips facets">
						{#each schoolsPresent as school (school)}
							<button
								class="pick-chip"
								aria-pressed={schools.includes(school)}
								class:on={schools.includes(school)}
								onclick={() => toggleSchool(school)}>{titleCase(school)}</button
							>
						{/each}
						<button
							class="pick-chip"
							aria-pressed={concentrationOnly}
							class:on={concentrationOnly}
							onclick={() => (concentrationOnly = !concentrationOnly)}
							>{$_('build.spells.concentration')}</button
						>
						<button
							class="pick-chip"
							aria-pressed={ritualOnly}
							class:on={ritualOnly}
							onclick={() => (ritualOnly = !ritualOnly)}>{$_('build.spells.ritual')}</button
						>
					</div>
				{/snippet}
			</SectionedPicker>
		</div>
	{/each}
{:else if b.classRow}
	<p class="subtext">{$_('build.spells.noCasting', { values: { class: rowName(b.classRow) } })}</p>
{:else}
	<p class="subtext">{$_('build.spells.needClass')}</p>
{/if}

<style>
	/* One caster is the common case and takes the whole pane. Multiclass stacks them, each with its
	   OWN list and its own scrollbar — siblings, never nested, so a wheel is never ambiguous. */
	.caster {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		padding-top: var(--space-2-5);
		border-top: 1px solid var(--color-border);
	}
	.caster:first-of-type {
		border-top: 0;
		padding-top: 0;
	}
	.facets {
		margin-top: var(--space-2);
		flex: none;
	}
</style>
