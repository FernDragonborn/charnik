<script lang="ts">
	// The headline numbers, in a row: what a DM asks for at the table. Every one of them is derived
	// and carries its own provenance on hover — the sheet never shows a bare number (AGENTS.md).
	import { _ } from '$lib/i18n';
	import { build } from '../build-view-model.svelte';
	import { signed } from '$lib/util/format';
	import { why } from '$lib/combat/effects-view';
	import { metres } from '$lib/combat/constants';
	const b = build;

	const s = $derived(b.sheet);
	const caster = $derived(s?.spellcasting.classes[0]);
</script>

{#if s}
	<div class="vitals">
		<div class="tile" title={why(s.ac)}><b>{s.ac.value}</b><small>{$_('build.vitals.ac')}</small></div>
		<div class="tile" title={why(s.maxHp)}><b>{s.maxHp.value}</b><small>{$_('build.vitals.maxHp')}</small></div>
		<div class="tile" title={why(s.initiative)}><b>{signed(s.initiative.value)}</b><small>{$_('build.vitals.initiative')}</small></div>
		<div class="tile" title={why(s.speed)}>
			<b>{s.speed.value}</b><small
				>{$_('build.vitals.speed', { values: { metres: metres(s.speed.value) } })}</small
			>
		</div>
		{#if s.hitDice.length}
			<div class="tile" title={$_('build.vitals.hitDiceHint')}>
				<b>{s.hitDice.map((h) => `${h.max}${h.die}`).join(' · ')}</b><small>{$_('build.vitals.hitDice')}</small>
			</div>
		{/if}
		{#if caster}
			<div class="tile gold" title={why(caster.saveDC)}>
				<b>{caster.saveDC.value}</b><small>{$_('build.vitals.spellDc')}</small>
			</div>
			<div class="tile gold" title={why(caster.attack)}>
				<b>{signed(caster.attack.value)}</b><small>{$_('build.vitals.spellAttack')}</small>
			</div>
		{/if}
	</div>
{/if}

<style>
	/* ONE row, always. `auto-fit` wrapped a caster's seven tiles onto a second row that was mostly
	   empty air; these are the headline numbers and they read as a strip, so they share the width
	   instead of claiming a minimum and spilling. */
	.vitals {
		display: flex;
		gap: var(--space-2);
	}
	.vitals :global(.tile) {
		flex: 1 1 0;
		min-width: 0;
		padding-inline: var(--space-1);
	}
	.vitals :global(.tile small) {
		display: block;
		line-height: 1.2;
		letter-spacing: 0.06em;
	}
	/* below this the strip stops fitting seven tiles legibly and wrapping is the lesser evil */
	@media (max-width: 900px) {
		.vitals {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
		}
	}
	.tile.gold b {
		color: var(--color-resource);
	}
</style>
