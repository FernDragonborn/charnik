<script lang="ts">
	// Ability boosts & feats card: one ASI/feat slot per qualifying level (per class), the
	// background origin feat (auto), and per-slot ASI allocation (+2 one / +1 two).
	import { build, rowName, ASI } from '../state.svelte';
	import { ABILITIES } from '$lib/character/schema';
	import { SKILL_ABILITY } from '$lib/character/derive';
	import { titleCase } from '$lib/util/format';
	const b = build;
	const SKILLS = Object.keys(SKILL_ABILITY);
</script>

<div class="card">
	<h2>Ability boosts &amp; feats <span class="count">{b.filledSlots}/{b.featSlots.length}</span></h2>
	{#if !b.classId}
		<p class="subtext">Pick a class to see its ASI / feat slots.</p>
	{:else}
		{#if b.originFeatRef}
			<div class="field-row">
				<span class="level-tag gold">BG</span>
				<span class="feat-line"><b>Origin feat</b> — {rowName(b.graph?.get(b.originFeatRef))} <span class="subtext">(granted)</span></span>
			</div>
			{@const originSkills = b.featSkillCountOf(b.originFeatRef)}
			{#if originSkills > 0}{@render skillPicker('origin', originSkills)}{/if}
		{/if}
		{#each b.featSlots as slot (slot.key)}
			{@const chosen = b.draft.slotFeats[slot.key] ?? ''}
			{@const asi = b.draft.slotAsi[slot.key]}
			{@const multi = b.draft.classes.length > 1}
			<div class="field-row" class:done={!!chosen}>
				<span class="level-tag">{multi ? `${slot.className.slice(0, 3)} ` : ''}L{slot.level}</span>
				<select class="bare feat-select" value={chosen} onchange={(e) => b.setSlotFeat(slot.key, e.currentTarget.value)}>
					<option value="">— ASI or feat —</option>
					<option value={ASI}>Ability Score Improvement (+2 or +1/+1)</option>
					{#each b.featOptionsFor(slot.level) as f (f.effectiveId)}
						<option value={f.effectiveId} disabled={b.featOptionBlocked(f.effectiveId, slot.key)}>
							{rowName(f)}{b.isRepeatable(f.effectiveId) ? ' ↻' : ''}
						</option>
					{/each}
				</select>
			</div>
			{#if chosen === ASI && asi}
				<div class="asi-block">
					<div class="segment-group small">
						<button class:on={asi.shape === '2'} onclick={() => b.setAsiShape(slot.key, '2')}>+2 one</button>
						<button class:on={asi.shape === '1-1'} onclick={() => b.setAsiShape(slot.key, '1-1')}>+1 / +1</button>
					</div>
					<div class="chips">
						{#each ABILITIES as ab (ab)}
							{@const amt = b.asiBoostFor(slot.key)[ab]}
							<button class="pick-chip" class:on={asi.picks.includes(ab)} onclick={() => b.toggleAsiPick(slot.key, ab)}>
								{ab.toUpperCase()}{#if amt}<span class="gold"> +{amt}</span>{/if}
							</button>
						{/each}
					</div>
				</div>
			{:else if chosen && chosen !== ASI}
				{@const halfOpts = b.halfFeatOptionsFor(slot.key)}
				{#if halfOpts.length}
					<div class="asi-block">
						<span class="subtext"
							>+1 ability {halfOpts.length === ABILITIES.length ? '(any)' : ''}</span
						>
						<div class="chips">
							{#each halfOpts as ab (ab)}
								<button class="pick-chip" class:on={b.draft.slotFeatAbility[slot.key] === ab} onclick={() => b.setSlotFeatAbility(slot.key, ab)}>
									{ab.toUpperCase()}
								</button>
							{/each}
						</div>
					</div>
				{/if}
				{@const skillCount = b.featSkillCountOf(chosen)}
				{#if skillCount > 0}{@render skillPicker(slot.key, skillCount)}{/if}
			{/if}
		{/each}
		<p class="subtext note">↻ = repeatable — take it in more than one slot. ASI &amp; feats apply to the preview.</p>
	{/if}
</div>

{#snippet skillPicker(key: string, cap: number)}
	{@const picks = b.slotFeatSkillsFor(key)}
	<div class="asi-block">
		<span class="subtext"
			>Skills — choose <b class="teal">{Math.min(picks.length, cap)}/{cap}</b>
			<span class="gold">(tools not yet supported)</span></span
		>
		<div class="chips">
			{#each SKILLS as skill (skill)}
				{@const on = picks.includes(skill)}
				{@const blocked = (b.draft.strict && b.featSkillTakenElsewhere(key, skill) && !on) || (!on && picks.length >= cap)}
				<button class="pick-chip" class:on class:dim={blocked} disabled={blocked} onclick={() => b.toggleSlotFeatSkill(key, skill, cap)}>
					{titleCase(skill)}
				</button>
			{/each}
		</div>
	</div>
{/snippet}

<style>
	.field-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 0;
		border-top: 1px solid var(--color-border);
	}
	.field-row:first-of-type {
		border-top: 0;
	}
	.field-row .level-tag {
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		border-radius: 5px;
		padding: 2px 7px;
	}
	.field-row.done .level-tag {
		border-color: var(--color-good);
		color: var(--color-good);
	}
	.field-row .feat-line {
		flex: 1;
		font-size: var(--font-size-sm);
	}
	.field-row .feat-line b {
		font-family: var(--font-display);
		font-weight: 600;
	}
	.feat-select {
		flex: 1;
	}
	.asi-block {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 4px 0 10px 34px;
	}
</style>
