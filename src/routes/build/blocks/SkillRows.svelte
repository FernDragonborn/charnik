<script lang="ts">
	// The skill list, grouped by governing ability — ONE component, used both on the sheet (two
	// columns) and in the inspector's skills pane (one column, with the counters above it). A row is
	// the toggle: click it to train the skill, click its dot to double proficiency. Background-granted
	// skills are locked on, because a background does not ask.
	import { _ } from '$lib/i18n';
	import { build } from '../build-view-model.svelte';
	import { SKILL_ABILITY, type SkillId } from '$lib/character/skills';
	import { ABILITIES } from '$lib/character/schema';
	import { signed, titleCase } from '$lib/util/format';
	import { why } from '$lib/combat/effects-view';
	const b = build;

	let { columns = 2 }: { columns?: number } = $props();

	const SKILLS = Object.keys(SKILL_ABILITY) as SkillId[];
	const groups = ABILITIES.map((ab) => ({
		ab,
		skills: SKILLS.filter((s) => SKILL_ABILITY[s] === ab)
	})).filter((g) => g.skills.length);
</script>

<div class="skills" style:columns>
	{#each groups as g (g.ab)}
		<div class="group">
			<div class="sectlab"><span>{g.ab}</span></div>
			{#each g.skills as skill (skill)}
				{@const auto = b.autoSkills.includes(skill)}
				{@const on = auto || b.draft.skills.includes(skill)}
				{@const pickable = b.skillPickable(skill)}
				{@const expert = b.draft.expertise.includes(skill)}
				{@const comp = b.sheet?.skills[skill]}
				<div class="skill" class:on class:dim={!on && !pickable}>
					<button
						class="name"
						disabled={auto || (!on && !pickable)}
						title={auto ? $_('build.skills.fromBackgroundHint') : comp ? why(comp) : ''}
						onclick={() => b.toggleSkill(skill)}
					>
						<i class="dot" class:prof={on} class:expert></i>
						<span>{titleCase(skill.replace(/_/g, ' '))}</span>
					</button>
					{#if on && b.expertiseCap > 0}
						{@const capped = !expert && b.draft.strict && b.expertiseUsed >= b.expertiseCap}
						<button
							class="x2"
							class:on={expert}
							class:dim={capped}
							disabled={capped}
							title={$_('build.skills.expertiseHint')}
							onclick={() => b.toggleExpertise(skill)}>×2</button
						>
					{/if}
					<b class="val">{comp ? signed(comp.value) : ''}</b>
				</div>
			{/each}
		</div>
	{/each}
</div>

<style>
	.skills {
		column-gap: 18px;
		column-rule: 1px solid var(--color-border);
	}
	.group {
		break-inside: avoid;
		margin-bottom: 8px;
	}
	.group .sectlab {
		margin-bottom: 2px;
	}
	.skill {
		display: flex;
		align-items: center;
		gap: 6px;
		break-inside: avoid;
		border-radius: var(--radius-sm);
	}
	.skill.dim {
		opacity: 0.4;
	}
	.name {
		all: unset;
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 7px;
		border-radius: var(--radius-sm);
		font-size: var(--font-size-sm);
		cursor: pointer;
	}
	.name:hover:not(:disabled) {
		background: var(--color-surface-2);
	}
	.name:disabled {
		cursor: default;
	}
	.name:focus-visible {
		outline: var(--focus-ring);
		outline-offset: -2px;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		border: 1.5px solid var(--color-border-strong);
		flex: none;
		display: block;
	}
	.dot.prof {
		border-color: var(--color-resource);
		background: var(--color-resource);
	}
	.dot.expert {
		box-shadow: 0 0 0 2px var(--color-resource-soft);
		border-color: var(--color-good);
		background: var(--color-good);
	}
	.x2 {
		all: unset;
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		font-weight: 700;
		padding: 1px 5px;
		border-radius: var(--radius-full);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.x2:hover:not(:disabled) {
		border-color: var(--color-border-strong);
	}
	.x2.on {
		border-color: var(--color-good);
		color: var(--color-good);
		background: var(--color-good-soft);
	}
	.x2.dim {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.x2:focus-visible {
		outline: var(--focus-ring);
		outline-offset: 1px;
	}
	.val {
		flex: none;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-sm);
		min-width: 26px;
		text-align: right;
		color: var(--color-text-muted);
	}
	.skill.on .val {
		color: var(--color-text);
	}
</style>
