<script lang="ts">
	// A feat/ASI slot. Deliberately NOT the plain pick layout: this level asks a question with two
	// different kinds of answer, so the ability-improvement option gets its own card with its own
	// allocator on top of the feat list, and a chosen feat's sub-choices (a half-feat's +1, a
	// skill-granting feat's picks) open right under it.
	import { _ } from '$lib/i18n';
	import { build, rowName, ASI } from '../build-view-model.svelte';
	import type { Inspector } from '../inspector.svelte';
	import { ABILITIES } from '$lib/character/schema';
	import { SKILL_ABILITY } from '$lib/character/skills';
	import { titleCase } from '$lib/util/format';
	import OptionGrid from './OptionGrid.svelte';
	import ChangeList from './ChangeList.svelte';
	const b = build;
	const SKILLS = Object.keys(SKILL_ABILITY);

	// `ins` is a prop for the same reason PickPane takes one — see there.
	let { slotKey, ins }: { slotKey: string; ins: Inspector } = $props();

	const chosen = $derived(b.draft.slotFeats[slotKey] ?? '');
	const asi = $derived(b.draft.slotAsi[slotKey]);
</script>

<button
	class="asi-card"
	class:on={ins.previewId === ASI}
	class:taken={chosen === ASI}
	onclick={() => ins.take(ASI)}
>
	<b>{$_('build.feats.asi')}</b>
	<span>{$_('build.feats.asiHint')}</span>
</button>

{#if chosen === ASI && asi}
	<div class="alloc">
		<div class="segment-group small" role="group" aria-label={$_('build.feats.asiShape')}>
			<button class:on={asi.shape === '2'} onclick={() => b.feats.setAsiShape(slotKey, '2')}>{$_('build.feats.asiTwo')}</button>
			<button class:on={asi.shape === '1-1'} onclick={() => b.feats.setAsiShape(slotKey, '1-1')}>{$_('build.feats.asiOneOne')}</button>
		</div>
		<div class="chips">
			{#each ABILITIES as ab (ab)}
				{@const amount = b.feats.asiBoostFor(slotKey)[ab]}
				<button
					class="pick-chip"
					class:on={asi.picks.includes(ab)}
					onclick={() => b.feats.toggleAsiPick(slotKey, ab)}
				>
					{ab.toUpperCase()}{#if amount}<span class="gold"> +{amount}</span>{/if}
				</button>
			{/each}
		</div>
	</div>
{/if}

{#if ins.pick}
	<OptionGrid
		options={ins.options}
		bind:query={ins.query}
		previewId={ins.previewId}
		takenIds={ins.pick.currentId ? [ins.pick.currentId] : []}
		onpreview={(id) => (ins.previewId = id)}
		ontake={ins.take}
		detail={ins.detail}
		placeholder={$_('build.feats.searchFeats')}
	/>
{/if}

<!-- everything the slot owes ONCE something is in it. Its own region, because a Skilled-shaped feat
     adds eighteen skill chips under here and the grid above must not be the thing that gives way. -->
<div class="slotfoot scrolly">
	{#if ins.changes.length}
		<ChangeList changes={ins.changes} />
	{:else}
		<ChangeList changes={ins.applied} taken />
	{/if}

	<!-- a taken feat's own sub-choices: the +1 a half-feat grants, and the skills a Skilled-shaped feat
	     hands out. They belong to the slot, so they live with it rather than in a separate pane. -->
{#if chosen && chosen !== ASI}
	{@const halfOpts = b.feats.halfFeatOptionsFor(slotKey)}
	{#if halfOpts.length}
		<div class="alloc">
			<span class="eyebrow"
				>{$_('build.feats.halfFeatAsk', { values: { feat: rowName(b.row(chosen)) } })}</span
			>
			<div class="chips">
				{#each halfOpts as ab (ab)}
					<button
						class="pick-chip"
						class:on={b.draft.slotFeatAbility[slotKey] === ab}
						onclick={() => b.feats.setSlotFeatAbility(slotKey, ab)}>{ab.toUpperCase()}</button
					>
				{/each}
			</div>
		</div>
	{/if}
	{@const skillCount = b.feats.featSkillCountOf(chosen)}
	{#if skillCount > 0}
		{@const picks = b.feats.slotFeatSkillsFor(slotKey)}
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
					{@const blocked =
						(b.draft.strict && b.feats.featSkillTakenElsewhere(slotKey, skill) && !on) ||
						(!on && picks.length >= skillCount)}
					<button
						class="pick-chip"
						class:on
						class:dim={blocked}
						disabled={blocked}
						onclick={() => b.feats.toggleSlotFeatSkill(slotKey, skill, skillCount)}
					>
						{titleCase(skill.replace(/_/g, ' '))}
					</button>
				{/each}
			</div>
		</div>
	{/if}
{/if}
</div>

<style>
	.slotfoot {
		display: flex;
		flex-direction: column;
		gap: 11px;
		flex: 0 1 auto;
		min-height: 0;
		overflow: auto;
	}
	.asi-card {
		all: unset;
		box-sizing: border-box;
		flex: none;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 11px 13px;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface-2);
	}
	.asi-card:hover {
		border-color: var(--color-accent);
	}
	.asi-card.on {
		border-color: var(--color-accent);
		background: var(--color-accent-soft);
	}
	.asi-card.taken {
		border-color: var(--color-resource-line);
		background: var(--color-resource-soft);
	}
	.asi-card:focus-visible {
		outline: var(--focus-ring);
		outline-offset: 1px;
	}
	.asi-card b {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
	.asi-card span {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		line-height: 1.45;
	}
	.alloc {
		display: flex;
		flex-direction: column;
		flex: none;
		gap: 8px;
	}
</style>
