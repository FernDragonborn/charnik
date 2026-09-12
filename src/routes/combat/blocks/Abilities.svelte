<script lang="ts">
	// The six ability tiles (score + mod + saving throw). Tapping a tile rolls a check; tapping the
	// SAVE row rolls the save. Reads the `combat` view-model; the derived sheet comes in as a prop.
	import Icon from '$lib/components/Icon.svelte';
	import type { CharacterSheet } from '$lib/character/derive';
	import { combat } from '../combat-view-model.svelte';
	import { why, signed, ABIL } from '$lib/combat/helpers';
	import { provenance } from '$lib/actions/provenance';
	import { _ } from '$lib/i18n';
	import { abilityShortLabel } from '$lib/util/format';

	let { s }: { s: CharacterSheet } = $props();
	const collapsed = $derived(combat.layout.collapsed);
	const { toggle } = combat.layout;
	const { roll } = combat;
</script>

<div class="sectlab">
	<button class="slabtoggle" onclick={() => toggle('abilities')}
		><span class="chevron"
			><Icon name={collapsed.abilities ? 'chevron-right' : 'chevron-down'} size={13} /></span
		>{$_('combat.section.abilities')}</button
	><em>{$_('combat.section.abilitiesHint')}</em>
</div>
{#if !collapsed.abilities}
	<section class="grid">
		{#each ABIL as ab (ab)}
			{@const a = s.abilities[ab]}
			{@const prof = a.saveProficient}
			<!-- a tile is NOT a button (it holds two): a check button + a save button, both keyboard-
			     reachable — a nested <button> is invalid HTML and drops the save from the tab order -->
			<div class="ability">
				<button
					type="button"
					class="ability-check"
					use:provenance={why(a.check, $_)}
					onclick={(e) =>
						roll(
							{ text: `${ab.toUpperCase()} check`, key: `combat.roll.check.${ab}` },
							a.check.value,
							e,
							`check.${ab}`,
						)}
				>
					<span class="ability-name">
						<b>{abilityShortLabel(ab, $_)}</b> · {a.score.value}
					</span>
					<!-- the folded CHECK bonus, not the raw modifier: this button rolls a check, and a row
					     that prints one number and rolls another is the defect, not the tidier layout -->
					<span class="ability-mod">{signed(a.check.value)}</span>
				</button>
				<button
					type="button"
					class="ability-save"
					class:prof
					use:provenance={why(a.save, $_)}
					onclick={(e) =>
						roll(
							{ text: `${ab.toUpperCase()} save`, key: `combat.roll.save.${ab}` },
							a.save.value,
							e,
							`save.${ab}`,
						)}
				>
					<i class="prof-dot" class:on={prof}></i>{$_('combat.section.save')}
					<b>{signed(a.save.value)}</b>
				</button>
			</div>
		{/each}
	</section>
{/if}

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: var(--space-2-5);
		margin-bottom: 22px;
	}
	@media (max-width: 640px) {
		.grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	/* UBUG-18: the ability cards are panels like every other block on the sheet, so they sit on
	   --color-surface with their inner controls on --color-surface-2 (the HpPanel relationship), not
	   the other way round — the inverted pair read as a different, darker kind of block. */
	.ability {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-3) var(--space-2);
		color: var(--color-text);
		display: block;
		width: 100%;
	}
	.ability .ability-check {
		display: block;
		width: 100%;
		text-align: center;
		background: none;
		border: 0;
		padding: 0;
		color: inherit;
		cursor: pointer;
	}
	.ability .ability-check:hover {
		filter: brightness(1.08);
	}
	.ability:hover {
		border-color: var(--color-border-strong);
		background: var(--color-surface-2);
	}
	.ability .ability-name {
		display: block;
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
		text-transform: uppercase;
	}
	.ability .ability-name b {
		color: var(--color-text);
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
	.ability .ability-mod {
		display: block;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-h1);
		line-height: 1;
		margin: var(--space-1-5) 0 var(--space-2);
	}
	.ability .ability-save {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1-5);
		width: 100%;
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		line-height: 1;
		color: var(--color-text-muted);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: var(--space-1) var(--space-1-5);
		cursor: pointer;
	}
	.ability .ability-save:hover {
		border-color: var(--color-accent);
		color: var(--color-text);
	}
	.ability .ability-save b {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-xs);
		line-height: 1;
		color: var(--color-text);
	}
	.ability .ability-save.prof {
		border-color: var(--color-resource);
		color: var(--color-resource);
	}
	.ability .ability-save.prof b {
		color: var(--color-resource);
	}
	.ability .ability-save .prof-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		border: 1.5px solid var(--color-border-strong);
	}
	.ability .ability-save .prof-dot.on {
		background: var(--color-resource);
		border-color: var(--color-resource);
	}
</style>
