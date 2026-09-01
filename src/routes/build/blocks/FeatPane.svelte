<script lang="ts">
	// A feat/ASI slot. Deliberately NOT the plain pick layout: this level asks a question with two
	// different kinds of answer, so the ability-improvement option gets its own card with its own
	// allocator on top of the feat list, and a chosen feat's sub-choices (a half-feat's +1, a
	// skill-granting feat's picks) open right under it.
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import { build, rowName, ASI } from '../build-view-model.svelte';
	import { skillLabel } from '../rows';
	import type { Inspector } from '../inspector.svelte';
	import { ABILITIES } from '$lib/character/schema';
	import { SKILL_ABILITY } from '$lib/character/skills';
	import InspectorGrid from './InspectorGrid.svelte';
	const b = build;
	const SKILLS = Object.keys(SKILL_ABILITY);

	// `ins` is a prop for the same reason InspectorGrid takes one — see there.
	let { slotKey, ins }: { slotKey: string; ins: Inspector } = $props();

	const chosen = $derived(b.draft.slotFeats[slotKey] ?? '');
	const asi = $derived(b.draft.slotAsi[slotKey]);
</script>

<!-- Reading and taking are separate controls here too (ui.md §6, §11): the card body highlights the
     option so the diff below says what +2 would do, and the ✓ on its left commits it — the same pair
     the sectioned picker's rows carry. A single click that committed made this the one thing in the
     pane that decided for you. -->
<div class="asi-card" class:is-active={ins.previewId === ASI} class:is-taken={chosen === ASI}>
	<button
		class="addbtn"
		class:on={chosen === ASI}
		aria-pressed={chosen === ASI}
		aria-label={$_('build.picker.takeRow', { values: { name: $_('build.feats.asi') } })}
		onclick={() => ins.take(ASI)}
	>
		<Icon name="check" size={12} />
	</button>
	<button
		class="asi-body"
		onclick={(event) => event.detail < 2 && (ins.previewId = ASI)}
		ondblclick={() => ins.take(ASI)}
	>
		<b>{$_('build.feats.asi')}</b>
		<span>{$_('build.feats.asiHint')}</span>
	</button>
</div>

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

<!-- everything the slot owes once something is in it goes in the SAME scroll region as the feats: a
     Skilled-shaped feat adds eighteen skill chips under there, and one region that grows is what
     keeps a short pane from clipping the grid AND the chips at once. -->
<InspectorGrid {ins} placeholder={$_('build.feats.searchFeats')}>
	{#snippet extra()}
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
					<!-- blocked only by ANOTHER slot already granting it. Being at the cap is not a block:
					     a click there replaces the oldest pick, so the grant is never a dead end. -->
					{@const blocked =
						b.draft.strict && b.feats.featSkillTakenElsewhere(slotKey, skill) && !on}
					<button
						class="pick-chip"
						class:on
						class:dim={blocked}
						disabled={blocked}
						onclick={() => b.feats.toggleSlotFeatSkill(slotKey, skill, skillCount)}
					>
						{skillLabel(skill, $_)}
					</button>
				{/each}
			</div>
		</div>
	{/if}
{/if}
	{/snippet}
</InspectorGrid>

<style>
	/* the row shape the sectioned picker uses: state on the left, the thing itself beside it */
	.asi-card {
		box-sizing: border-box;
		flex: none;
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 11px 13px;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface-2);
	}
	.asi-card:hover {
		border-color: var(--color-accent);
	}
	.asi-body {
		all: unset;
		flex: 1;
		min-width: 0;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.asi-body:focus-visible {
		outline: var(--focus-ring);
		outline-offset: 3px;
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
