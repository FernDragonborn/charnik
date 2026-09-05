<script lang="ts">
	// What a feat asks back once it is on the character: the +1 a half-feat grants, and the skills a
	// Skilled-shaped feat hands out. Both are driven by the feat's own columns (`ability_choice`,
	// `skill_choice`), so a homebrew feat asking either question just works.
	//
	// ONE component for both keys a choice can hang off — a level's slot, and the background's granted
	// origin feat. The questions a feat asks do not depend on how it arrived, and written twice they
	// drift: the origin feat's copy did not exist at all, so Skilled granted nothing.
	import { _ } from '$lib/i18n';
	import { abilityShortLabel } from '$lib/util/format';
	import { build, rowName, ASI } from '../build-view-model.svelte';
	import { skillLabel } from '../rows';
	import { SKILL_ABILITY } from '$lib/character/skills';
	const b = build;
	const SKILLS = Object.keys(SKILL_ABILITY);

	/** The slot key, or `ORIGIN_SLOT_KEY` — whichever the choices are stored under. */
	let { choiceKey }: { choiceKey: string } = $props();

	const ref = $derived(b.feats.featRefFor(choiceKey));
	const halfOpts = $derived(ref && ref !== ASI ? b.feats.halfFeatOptionsFor(choiceKey) : []);
	const skillCount = $derived(ref && ref !== ASI ? b.feats.featSkillCountOf(ref) : 0);
	const picks = $derived(b.feats.slotFeatSkillsFor(choiceKey));
</script>

{#if halfOpts.length}
	<div class="alloc">
		<span class="eyebrow">{$_('build.feats.halfFeatAsk', { values: { feat: rowName(b.row(ref)) } })}</span>
		<div class="chips">
			{#each halfOpts as ab (ab)}
				<button
					class="pick-chip"
					class:on={b.draft.slotFeatAbility[choiceKey] === ab}
					onclick={() => b.feats.setSlotFeatAbility(choiceKey, ab)}>{abilityShortLabel(ab, $_)}</button
				>
			{/each}
		</div>
	</div>
{/if}

{#if skillCount > 0}
	<div class="alloc">
		<span class="eyebrow">
			{$_('build.feats.skillGrant', {
				values: { chosen: Math.min(picks.length, skillCount), cap: skillCount }
			})}
			<span class="gold">{$_('build.feats.toolsNote')}</span>
		</span>
		<div class="chips">
			{#each SKILLS as skill (skill)}
				{@const on = picks.includes(skill)}
				<!-- blocked only by ANOTHER slot already granting it. Being at the cap is not a block:
				     a click there replaces the oldest pick, so the grant is never a dead end. -->
				{@const blocked =
					b.draft.strict && b.feats.featSkillTakenElsewhere(choiceKey, skill) && !on}
				<button
					class="pick-chip"
					class:on
					class:dim={blocked}
					disabled={blocked}
					onclick={() => b.feats.toggleSlotFeatSkill(choiceKey, skill, skillCount)}
				>
					{skillLabel(skill, $_)}
				</button>
			{/each}
		</div>
	</div>
{/if}
