<script lang="ts">
	// Skills, with the part the sheet can't show: which ones your class actually offers, how many
	// picks are left, and where the ones you already have came from. The rows themselves are the same
	// shared `SkillRows` the sheet uses — a skill is trained in exactly one control.
	import { _ } from '$lib/i18n';
	import { build } from '../build-view-model.svelte';
	import { skillLabel } from '../rows';
	import SkillRows from './SkillRows.svelte';
	import SkillCounts from './SkillCounts.svelte';
	const b = build;
</script>

<div class="counts"><SkillCounts badge="tag" /></div>

{#if b.skillPicks.classSkillCount > 0}
	<p class="subtext">
		{$_(b.draft.strict ? 'build.skills.classList' : 'build.skills.classListFree', {
			values: { skills: b.skillPicks.classSkillOptions.map((s) => skillLabel(s, $_)).join(' · ') }
		})}
	</p>
{:else if b.primaryClassId}
	<p class="subtext">{$_('build.skills.noRestriction')}</p>
{:else}
	<p class="subtext">{$_('build.skills.needClass')}</p>
{/if}

{#if b.skillPicks.autoSkills.length}
	<p class="subtext note">
		{$_('build.skills.lockedOn', { values: { skills: b.skillPicks.autoSkills.map((s) => skillLabel(s, $_)).join(' · ') } })}
	</p>
{/if}

<SkillRows columns={1} />

<style>
	.counts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1-5);
	}
</style>
