<script lang="ts">
	import { _ } from '$lib/i18n';
	import { build, rowName } from '../build-view-model.svelte';
	import type { LoadedRow } from '$lib/content/loader';
	import { abilityShortLabel, titleCase } from '$lib/util/format';
	import { ISSUE_KEY } from '$lib/effects/issues';
	import { rowDetail } from '../rows';
	import SectionedPicker from './SectionedPicker.svelte';
	const b = build;

	let query = $state('');
	let previewId = $state<string | null>(null);
	let schools = $state<string[]>([]);
	let concentrationOnly = $state(false);
	let ritualOnly = $state(false);

	const detail = $derived(rowDetail(previewId ? b.row(previewId) : undefined, 'spell'));
	const levelLabel = (level: number) =>
		level === 0
			? $_('build.spells.groupCantrips')
			: $_('build.spells.groupLevel', { values: { level } });
	const schoolsPresent = $derived(
		[
			...new Set(
				(b.spellPicks.active?.groups ?? [])
					.flatMap((group) => group.spells)
					.map((spell) => (spell.type === 'spell' ? String(spell.data.school) : ''))
					.filter(Boolean),
			),
		].sort(),
	);
	const sections = $derived(
		(b.spellPicks.active?.groups ?? [])
			.map((group) => ({
				key: String(group.level),
				label: levelLabel(group.level),
				rows: group.spells.filter(passesFacets),
			}))
			.filter((section) => section.rows.length),
	);

	function passesFacets(row: LoadedRow): boolean {
		if (row.type !== 'spell') return true;
		if (schools.length && !schools.includes(String(row.data.school))) return false;
		if (concentrationOnly && !row.data.concentration) return false;
		if (ritualOnly && !row.data.ritual) return false;
		return true;
	}
	const toggleSchool = (school: string) =>
		(schools = schools.includes(school)
			? schools.filter((chosen) => chosen !== school)
			: [...schools, school]);
	const selectProfile = (id: string) => {
		b.spellPicks.profileId = id;
		previewId = null;
		schools = [];
	};
	const profileName = (id: string, fallback: string) => {
		const choice = b.feats.featSpellPicks.find((taken) => `${taken.feat}.${taken.key}` === id);
		if (!choice) return rowName(b.row(id)) || fallback;
		const list = b.feats.featSpellListsFor(choice.key).find((row) => row.id === choice.list);
		return `${rowName(b.row(choice.feat))} · ${rowName(list)}`;
	};
</script>

{#if b.spellPicks.picker.length}
	<div class="profiles" role="group" aria-label={$_('build.spells.title')}>
		{#each b.spellPicks.picker as pc (pc.profile.classEffectiveId)}
			<button
				class="slot profile"
				class:active={b.spellPicks.active?.profile.classEffectiveId === pc.profile.classEffectiveId}
				aria-pressed={b.spellPicks.active?.profile.classEffectiveId === pc.profile.classEffectiveId}
				onclick={() => selectProfile(pc.profile.classEffectiveId)}
			>
				<span class="eyebrow"
					>{profileName(pc.profile.classEffectiveId, pc.profile.className)} · {abilityShortLabel(
						pc.profile.ability,
						$_,
					)}</span
				>
				<span class="chips">
					<span class="tag" class:accent={pc.cantripsChosen < pc.profile.cantripCap}>
						{$_('build.spells.cantrips', {
							values: { chosen: pc.cantripsChosen, cap: pc.profile.cantripCap },
						})}
					</span>
					<span class="tag" class:accent={pc.leveledChosen < pc.profile.preparedCap}>
						{$_(
							pc.profile.prepareStyle === 'known' ? 'build.spells.known' : 'build.spells.prepared',
							{ values: { chosen: pc.leveledChosen, cap: pc.profile.preparedCap } },
						)}
					</span>
				</span>
			</button>
		{/each}
	</div>
	{#if b.spellPicks.activeFeat && b.spellPicks.activeFeat.spells === undefined}
		<p class="subtext">
			{$_(ISSUE_KEY.featSpellOwnershipMissing, {
				values: { source: rowName(b.row(b.spellPicks.activeFeat.feat)) },
			})}
		</p>
	{/if}
	<SectionedPicker
		{sections}
		bind:query
		{previewId}
		takenIds={b.spellPicks.activeHeld}
		onpreview={(id) => (previewId = id)}
		ontake={b.spellPicks.toggleForActive}
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
{:else if b.classRow}
	<p class="subtext">{$_('build.spells.noCasting', { values: { class: rowName(b.classRow) } })}</p>
{:else}
	<p class="subtext">{$_('build.spells.needClass')}</p>
{/if}

<style>
	.profiles {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		flex: none;
	}
	.profile {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: var(--space-1-5);
		padding: var(--space-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius);
	}
	.facets {
		margin-top: var(--space-2);
		flex: none;
	}
</style>
