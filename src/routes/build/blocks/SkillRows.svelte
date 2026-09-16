<script lang="ts">
	// The skill list, grouped by governing ability — ONE component, used both on the sheet (two
	// columns) and in the inspector's skills pane (one column, with the counters above it). A row is
	// the toggle: click it to train the skill, click its dot to double proficiency. Background-granted
	// skills are locked on, because a background does not ask.
	import { _ } from '$lib/i18n';
	import { build } from '../build-view-model.svelte';
	import { skillLabel } from '../rows';
	import { SKILL_ABILITY, type SkillId } from '$lib/character/skills';
	import { ABILITIES } from '$lib/character/schema';
	import { signed } from '$lib/util/format';
	import { why, whyPassive } from '$lib/combat/effects-view';
	import { provenance } from '$lib/actions/provenance';
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
				{@const auto = b.skillPicks.autoSkills.includes(skill)}
				{@const picked = b.draft.skills.includes(skill)}
				{@const comp = b.sheet?.skills[skill]}
				<!-- A FEATURE granted this one (Diamond Soul's kin, an item, a species trait): the sheet
				     says a rung the draft never picked and no background gave, so the row is locked on
				     and says why — the alternative is a skill that looks pickable, un-picks to no
				     effect, and reads as a bug. `partial` (Jack of All Trades) is NOT a lock: it grants
				     nothing to un-pick and the skill stays yours to train. -->
				{@const granted =
					!auto && !picked && (comp?.prof === 'proficient' || comp?.prof === 'expertise')}
				{@const on = auto || granted || picked}
				{@const pickable = b.skillPicks.pickable(skill)}
				{@const expert = b.draft.expertise.includes(skill)}
				{@const pas = b.sheet?.passives[skill]}
				<div class="skill" class:on class:dim={!on && !pickable}>
					<button
						class="name"
						disabled={auto || granted || (!on && !pickable)}
						title={auto
							? $_('build.skills.fromBackgroundHint')
							: granted
								? $_('build.skills.fromFeatureHint')
								: ''}
						onclick={() => b.skillPicks.toggleSkill(skill)}
					>
						<i class="dot" class:prof={on} class:expert class:partial={comp?.prof === 'partial'}></i>
						<span>{skillLabel(skill, $_)}</span>
					</button>
					{#if b.skillPicks.expertiseOffered(skill)}
						<button
							class="x2"
							class:on={expert}
							title={$_('build.skills.expertiseHint')}
							onclick={() => b.skillPicks.toggleExpertise(skill)}>×2</button
						>
					{/if}
					<b class="val" use:provenance={comp ? why(comp, $_) : ''}>{comp ? signed(comp.value) : ''}</b>
					<!-- every skill has a passive score, not just the three the old card listed (derive.ts
					     `passives` is keyed by SkillId) — so it reads here, next to the check it belongs to,
					     instead of in a separate card that could only ever show three of them. -->
					{#if pas}<span class="passive" use:provenance={whyPassive(pas, $_)}>{pas.value}</span>{/if}
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
		margin-bottom: var(--space-2);
	}
	.group .sectlab {
		margin-bottom: 2px;
	}
	.skill {
		display: flex;
		align-items: center;
		gap: var(--space-1-5);
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
		gap: var(--space-2);
		padding: var(--space-1) var(--space-1-5);
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
	/* partial proficiency (Jack of All Trades) = a faded fill, between empty and proficient — the same
	   reading as the play sheet's own dot, so one tier looks like one tier in both views */
	.dot.partial {
		background: color-mix(in srgb, var(--color-resource) 45%, transparent);
		border-color: var(--color-resource);
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
		padding: 1px var(--space-1);
		border-radius: var(--radius-full);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.x2:hover {
		border-color: var(--color-border-strong);
	}
	.x2.on {
		border-color: var(--color-good);
		color: var(--color-good);
		background: var(--color-good-soft);
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
		text-align: end;
		color: var(--color-text-muted);
	}
	.skill.on .val {
		color: var(--color-text);
	}
	/* the passive score: quieter than the check, because it is what happens without rolling */
	.passive {
		flex: none;
		min-width: 20px;
		text-align: end;
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
		border-inline-start: 1px solid var(--color-border);
		padding-inline-start: var(--space-1-5);
	}
	.skill.on .passive {
		color: var(--color-resource);
	}
</style>
