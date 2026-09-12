<script lang="ts">
	// Skills panel body: two columns of skills grouped by governing ability; each row rolls the check
	// and shows proficiency tier (none / partial / proficient / expertise) + provenance on hover.
	import { SKILL_ABILITY, type SkillId, type CharacterSheet } from '$lib/character/derive';
	import { _ } from '$lib/i18n';
	import { combat } from '../../combat-view-model.svelte';
	import { why, signed, titleCase, ABIL, skillRollTarget } from '$lib/combat/helpers';
	import { provenance } from '$lib/actions/provenance';

	let { s }: { s: CharacterSheet } = $props();
	const { roll } = combat;
	// friendly label per proficiency tier (the dot's own hover; the row hover keeps the full why())
	// catalog KEYS, not words — the dot's hover reads in the player's language
	const PROF_LABEL = {
		none: 'combat.skills.profNone',
		partial: 'combat.skills.profPartial',
		proficient: 'combat.skills.profProficient',
		expertise: 'combat.skills.profExpertise',
	} as const;
</script>

<div class="sklgrid">
	{#each ABIL as ab (ab)}
		{@const list = (Object.keys(SKILL_ABILITY) as SkillId[]).filter((k) => SKILL_ABILITY[k] === ab)}
		{#if list.length}
			<div class="category-block">
				<div class="ability-heading">{$_(`abilityName.${ab}`)}</div>
				{#each list as skill (skill)}
					{@const sk = s.skills[skill]}
					{#if sk}
						<button
							class="skill-row"
							use:provenance={why(sk, $_)}
							onclick={(e) =>
								roll(
									{ text: titleCase(skill), key: `skillName.${skill}` },
									sk.value,
									e,
									skillRollTarget(skill, s),
								)}
						>
							<i
								class="prof-dot"
								class:on={sk.prof === 'proficient' || sk.prof === 'expertise'}
								class:partial={sk.prof === 'partial'}
								class:expertise={sk.prof === 'expertise'}
								title={$_(PROF_LABEL[sk.prof])}
							></i>
							<span class="skill-name"
								>{$_(`skillName.${skill}`, { default: titleCase(skill) })}</span
							>
							<b class="skill-mod">{signed(sk.value)}</b>
						</button>
					{/if}
				{/each}
			</div>
		{/if}
	{/each}
</div>

<style>
	.sklgrid {
		column-count: 2;
		column-gap: var(--space-4);
		column-rule: 1px solid var(--color-border);
	}
	.category-block {
		break-inside: avoid;
		margin-bottom: var(--space-1-5);
	}
	.ability-heading {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		padding: var(--space-1-5) 0 var(--space-1);
	}
	.skill-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius);
		break-inside: avoid;
		cursor: pointer;
		font-size: var(--font-size-sm);
		width: 100%;
		background: transparent;
		border: 0;
		color: var(--color-text);
		text-align: start;
	}
	.skill-row:hover {
		background: var(--color-surface-2);
	}
	.skill-row .prof-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		border: 1.5px solid var(--color-border-strong);
		flex: none;
	}
	.skill-row .prof-dot.on {
		background: var(--color-resource);
		border-color: var(--color-resource);
	}
	/* partial proficiency (Jack of All Trades) = a faded fill, between empty and proficient */
	.skill-row .prof-dot.partial {
		background: color-mix(in srgb, var(--color-resource) 45%, transparent);
		border-color: var(--color-resource);
	}
	/* expertise = a ringed dot (double proficiency) */
	.skill-row .prof-dot.expertise {
		box-shadow:
			0 0 0 2px var(--color-surface),
			0 0 0 3.5px var(--color-resource);
	}
	.skill-row .skill-name {
		flex: 1;
	}
	.skill-row .skill-mod {
		font-family: var(--font-display);
		font-weight: 700;
	}
</style>
