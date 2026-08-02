<script lang="ts">
	// Skills panel body: two columns of skills grouped by governing ability; each row rolls the check
	// and shows proficiency tier (none / half / proficient / expertise) + provenance on hover.
	import { SKILL_ABILITY, type SkillId, type CharacterSheet } from '$lib/character/derive';
	import { combat } from '../../state.svelte';
	import { why, signed, titleCase, ABIL, ABILITY_NAME } from '$lib/combat/helpers';

	let { s }: { s: CharacterSheet } = $props();
	const { roll } = combat;
	// friendly label per proficiency tier (the dot's own hover; the row hover keeps the full why())
	const PROF_LABEL = {
		none: 'Not proficient',
		half: 'Half proficiency',
		proficient: 'Proficient',
		expertise: 'Expertise (×2)'
	} as const;
</script>

<div class="sklgrid">
	{#each ABIL as ab (ab)}
		{@const list = (Object.keys(SKILL_ABILITY) as SkillId[]).filter((k) => SKILL_ABILITY[k] === ab)}
		{#if list.length}
			<div class="category-block">
				<div class="ability-heading">{ABILITY_NAME[ab]}</div>
				{#each list as skill (skill)}
					{@const sk = s.skills[skill]}
					{#if sk}
						<button
							class="skill-row"
							title={why(sk)}
							onclick={(e) => roll(titleCase(skill), sk.value, e, `skill.${skill}`)}
						>
							<i
								class="prof-dot"
								class:on={sk.prof === 'proficient' || sk.prof === 'expertise'}
								class:half={sk.prof === 'half'}
								class:expertise={sk.prof === 'expertise'}
								title={PROF_LABEL[sk.prof]}
							></i>
							<span class="skill-name">{titleCase(skill)}</span>
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
		column-gap: 16px;
		column-rule: 1px solid var(--color-border);
	}
	.category-block {
		break-inside: avoid;
		margin-bottom: 7px;
	}
	.ability-heading {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		padding: 6px 0 3px;
	}
	.skill-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 8px;
		border-radius: var(--radius);
		break-inside: avoid;
		cursor: pointer;
		font-size: var(--font-size-sm);
		width: 100%;
		background: transparent;
		border: 0;
		color: var(--color-text);
		text-align: left;
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
	/* half proficiency (Jack of All Trades) = a faded fill, between empty and proficient */
	.skill-row .prof-dot.half {
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
