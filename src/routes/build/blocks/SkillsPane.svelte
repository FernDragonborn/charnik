<script lang="ts">
	// Skills, with the part the sheet can't show: which ones your class actually offers, how many
	// picks are left, and where the ones you already have came from. The rows themselves are the same
	// shared `SkillRows` the sheet uses — a skill is trained in exactly one control.
	import { _ } from '$lib/i18n';
	import { build } from '../build-view-model.svelte';
	import SkillRows from './SkillRows.svelte';
	import { titleCase } from '$lib/util/format';
	const b = build;

	const label = (s: string) => titleCase(s.replace(/_/g, ' '));
</script>

<div class="counts">
	{#if b.classSkillCount > 0}
		<span class="tag" class:accent={b.skillChosenCount < b.classSkillCount}>
			{$_('build.skills.classPicks', {
				values: { chosen: b.skillChosenCount, cap: b.classSkillCount }
			})}
		</span>
	{/if}
	{#if b.autoSkills.length}<span class="tag gold"
			>{$_('build.skills.fromBackground', { values: { count: b.autoSkills.length } })}</span
		>{/if}
	{#if b.expertiseCap > 0}
		<span class="tag"
			>{$_('build.skills.expertise', { values: { used: b.expertiseUsed, cap: b.expertiseCap } })}</span
		>
	{/if}
</div>

{#if b.classSkillCount > 0}
	<p class="subtext">
		{$_(b.draft.strict ? 'build.skills.classList' : 'build.skills.classListFree', {
			values: { skills: b.classSkillOptions.map(label).join(' · ') }
		})}
	</p>
{:else if b.classId}
	<p class="subtext">{$_('build.skills.noRestriction')}</p>
{:else}
	<p class="subtext">{$_('build.skills.needClass')}</p>
{/if}

{#if b.autoSkills.length}
	<p class="subtext note">
		{$_('build.skills.lockedOn', { values: { skills: b.autoSkills.map(label).join(' · ') } })}
	</p>
{/if}

<SkillRows columns={1} />

<style>
	.counts {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
</style>
