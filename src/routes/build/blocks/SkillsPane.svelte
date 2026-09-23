<script lang="ts">
	// Skills, with the part the sheet can't show: which ones your class actually offers, how many
	// picks are left, and where the ones you already have came from. The rows themselves are the same
	// shared `SkillRows` the sheet uses — a skill is trained in exactly one control.
	import { _ } from '$lib/i18n';
	import { build, rowName } from '../build-view-model.svelte';
	import { skillLabel } from '../rows';
	import { SKILL_ABILITY } from '$lib/character/skills';
	import SkillRows from './SkillRows.svelte';
	import SkillCounts from './SkillCounts.svelte';
	const b = build;
	const SKILLS = Object.keys(SKILL_ABILITY);

	/* The species' own grant is asked as CHIPS rather than through the rows below, for the same reason
	   a feat's is: it has its own cap and its own list, and a shared row toggle could only spend one
	   of the two counts. */
	const speciesCount = $derived(b.skillPicks.speciesSkillCount);
	const speciesPicks = $derived(b.skillPicks.speciesSkillPicks);
	const speciesName = $derived(rowName(b.speciesOptionRow ?? b.speciesRow));
</script>

<div class="counts"><SkillCounts badge="tag" /></div>

{#if b.skillPicks.classSkillCount > 0}
	<p class="subtext">
		{$_(b.draft.strict ? 'build.skills.classList' : 'build.skills.classListFree', {
			values: { skills: b.skillPicks.classSkillOptions.map((s) => skillLabel(s, $_)).join(' · ') }
		})}
	</p>
{:else if b.classRows.primaryClassId}
	<p class="subtext">{$_('build.skills.noRestriction')}</p>
{:else}
	<p class="subtext">{$_('build.skills.needClass')}</p>
{/if}

{#if b.skillPicks.autoSkills.length}
	<p class="subtext note">
		{$_('build.skills.lockedOn', { values: { skills: b.skillPicks.autoSkills.map((s) => skillLabel(s, $_)).join(' · ') } })}
	</p>
{/if}

{#if speciesCount > 0}
	<div class="alloc">
		<span class="eyebrow">
			{$_('build.skills.speciesGrant', {
				values: { species: speciesName, chosen: speciesPicks.length, cap: speciesCount }
			})}
		</span>
		<div class="chips">
			{#each SKILLS as skill (skill)}
				{@const on = speciesPicks.includes(skill)}
				<!-- blocked only by another source ALREADY granting it. Being at the cap is not a block:
				     a click there replaces the oldest pick, so the grant is never a dead end. -->
				{@const blocked = b.draft.strict && b.skillPicks.speciesSkillTakenElsewhere(skill) && !on}
				<button
					class="pick-chip"
					class:on
					class:dim={blocked}
					disabled={blocked}
					onclick={() => b.skillPicks.toggleSpeciesSkill(skill)}
				>
					{skillLabel(skill, $_)}
				</button>
			{/each}
		</div>
	</div>
{/if}

<SkillRows columns={1} />

<style>
	.counts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1-5);
	}
</style>
