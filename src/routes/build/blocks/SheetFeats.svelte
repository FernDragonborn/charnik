<script lang="ts">
	// Every improvement this character's levels opened: the background's origin feat, then one slot
	// per ASI/feat level. A character built straight to level 12 owes four of these, so each is its own
	// row — an unfilled one reads crimson and is a click into the inspector, never a silent gap.
	import { _ } from '$lib/i18n';
	import { build, rowName, ASI } from '../build-view-model.svelte';
	import { rowText } from '../rows';
	import { ABILITIES } from '$lib/character/schema';
	const b = build;

	/** What a filled slot did, in one line — an ASI names the abilities it raised. */
	function asiSummary(key: string): string {
		const boost = b.feats.asiBoostFor(key);
		const parts = ABILITIES.filter((a) => boost[a]).map((a) => `${a.toUpperCase()} +${boost[a]}`);
		return parts.length ? parts.join(' · ') : $_('build.feats.asiNothing');
	}
</script>

<div class="card">
	<div class="card-head">
		<span class="eyebrow">{$_('build.feats.title')}</span>
		<span class="spacer"></span>
		<span class="trail" class:open={b.feats.filledSlots < b.feats.featSlots.length}>
			{$_('build.feats.slotsFilled', {
				values: { filled: b.feats.filledSlots, total: b.feats.featSlots.length }
			})}
		</span>
	</div>

	{#if !b.primaryClassId}
		<p class="subtext">{$_('build.feats.needClass')}</p>
	{:else}
		<div class="slots">
			{#if b.feats.originFeatRef}
				<!-- granted, not chosen — so it is not a slot: the level badge reads "origin", there is no
				     empty state, and opening it leads to what the feat asks back rather than to a list. -->
				{@const owed = b.feats.originChoicesOwed}
				<button
					class="slot featrow"
					class:is-taken={owed === 0}
					class:empty={owed > 0}
					class:active={b.inspector.isOpen({ id: 'originFeat' })}
					onclick={() => b.inspector.toggle({ id: 'originFeat' })}
				>
					<span class="lvl">{$_('build.feats.origin')}</span>
					<span class="ftext">
						<b>{rowName(b.row(b.feats.originFeatRef))}</b>
						<span class="clamp-2">
							{owed > 0
								? $_('build.feats.originOwes', { values: { count: owed } })
								: rowText(b.row(b.feats.originFeatRef)) || $_('build.feats.grantedByBackground')}
						</span>
					</span>
				</button>
			{/if}

			{#each b.feats.featSlots as slot (slot.key)}
				{@const chosen = b.draft.slotFeats[slot.key] ?? ''}
				{@const multi = b.draft.classes.length > 1}
				<button
					class="slot featrow"
					class:empty={!chosen}
					class:active={b.inspector.isOpen({ id: 'feat', slotKey: slot.key, level: slot.level })}
					onclick={() => b.inspector.toggle({ id: 'feat', slotKey: slot.key, level: slot.level })}
				>
					<span class="lvl" class:done={!!chosen}
						>{multi ? `${slot.className.slice(0, 3)} ` : ''}L{slot.level}</span
					>
					<span class="ftext">
						{#if chosen === ASI}
							<b>{$_('build.feats.asi')}</b>
							<span class="clamp-2">{asiSummary(slot.key)}</span>
						{:else if chosen}
							<b>{rowName(b.row(chosen))}</b>
							<span class="clamp-2">{rowText(b.row(chosen))}</span>
						{:else}
							<b>{$_('build.notChosen')}</b>
							<span class="clamp-2">{$_('build.feats.notChosenHint')}</span>
						{/if}
					</span>
				</button>
			{/each}

			{#if !b.feats.featSlots.length && !b.feats.originFeatRef}
				<p class="subtext">{$_('build.feats.noSlots')}</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* one slot per row: this card now sits in the narrower half of the pair, and a 280px minimum
	   forced it to overflow rather than reflow. */
	.slots {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-2);
	}
	.featrow {
		display: flex;
		gap: var(--space-2-5);
		align-items: flex-start;
		padding: var(--space-2) var(--space-2-5);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-surface-2);
		text-align: start;
	}
	/* the badge itself is `.lvl` in build.css; a slot's says a WORD as well as a number ("origin"),
	   so it is padded and letter-spaced here */
	.lvl {
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 2px var(--space-1-5);
		margin-top: 1px;
	}
	.lvl.done {
		border-color: var(--color-good);
		color: var(--color-good);
	}
	.ftext {
		gap: 2px;
	}
</style>
