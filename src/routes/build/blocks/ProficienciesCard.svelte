<script lang="ts">
	// Proficiencies & choices card: fixed class saving throws, skill picks (class choose-N +
	// background-granted, with expertise toggles) and language picks.
	import { build, rowName } from '../state.svelte';
	import { SKILL_ABILITY } from '$lib/character/derive';
	import { titleCase } from '$lib/util/format';
	const b = build;
</script>

<div class="card">
	<h2>Proficiencies &amp; choices</h2>
	<p class="subtext">Saving throws <span class="gold">(fixed by class)</span></p>
	<div class="chips spaced">
		{#if b.classRow}
			{#each String(b.classRow.data.saves).split(',') as sv (sv)}
				<span class="pick-chip locked">{sv.trim().toUpperCase()}</span>
			{/each}
		{:else}<span class="subtext">—</span>{/if}
	</div>

	<p class="subtext">
		Skills — choose <b class="teal">{b.skillChosenCount}/{b.classSkillCount}</b> from class
		{#if b.autoSkills.length}· <span class="gold">{b.autoSkills.length} from background</span>{/if}
		{#if b.expertiseCap > 0}· <span class="gold">expertise {b.expertiseUsed}/{b.expertiseCap}</span
			>{/if}
	</p>
	<div class="chips spaced">
		{#each Object.keys(SKILL_ABILITY) as skill (skill)}
			{@const auto = b.autoSkills.includes(skill)}
			{@const on = auto || b.draft.skills.includes(skill)}
			{@const pickable = b.skillPickable(skill)}
			<span class="skill-wrap">
				<button class="pick-chip" class:on class:locked={auto} class:dim={!pickable} disabled={auto || !pickable} onclick={() => b.toggleSkill(skill)}>
					{titleCase(skill)}
				</button>
				{#if on}
					{@const exp = b.draft.expertise.includes(skill)}
					{@const capped = !exp && b.draft.strict && b.expertiseUsed >= b.expertiseCap}
					<button class="expertise-toggle" class:on={exp} class:dim={capped} disabled={capped} title="Expertise (×2 proficiency)" onclick={() => b.toggleExpertise(skill)}>×2</button>
				{/if}
			</span>
		{/each}
	</div>

	<p class="subtext">
		Languages <span class="count">{b.draft.selectedLanguages.length}</span>
		{#if b.backgroundLangCount > 0}<span class="note">· background grants {b.backgroundLangCount}</span>{/if}
	</p>
	<div class="chips spaced">
		{#each b.languageList as r (r.effectiveId)}
			<button
				class="pick-chip"
				class:on={b.draft.selectedLanguages.includes(r.effectiveId)}
				onclick={() => b.toggleLanguage(r.effectiveId)}>{rowName(r)}</button
			>
		{/each}
	</div>
</div>

<style>
	.skill-wrap {
		display: inline-flex;
		align-items: stretch;
		gap: 3px;
	}
	.expertise-toggle {
		all: unset;
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		font-weight: 700;
		padding: 0 6px;
		display: grid;
		place-items: center;
		border-radius: var(--radius-full);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		background: var(--color-surface-2);
		cursor: pointer;
	}
	.expertise-toggle:hover {
		border-color: var(--color-border-strong);
	}
	.expertise-toggle.dim {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.expertise-toggle.on {
		background: var(--color-resource-soft);
		border-color: var(--color-resource);
		color: var(--color-resource);
	}
	.expertise-toggle:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
	}
</style>
