<script lang="ts">
	// The headline numbers, in a row: what a DM asks for at the table. Every one of them is derived
	// and carries its own provenance on hover — the sheet never shows a bare number (AGENTS.md).
	import { _ } from '$lib/i18n';
	import { build } from '../build-view-model.svelte';
	import { signed } from '$lib/util/format';
	import { why } from '$lib/combat/effects-view';
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
				>{$_('build.vitals.speed', { values: { metres: Math.round(s.speed.value * 0.3) } })}</small
			>
		</div>
		<div class="tile" title={why(s.passives.perception)}>
			<b>{s.passives.perception.value}</b><small>{$_('build.vitals.passivePerception')}</small>
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
	.vitals {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
		gap: 9px;
	}
	.tile.gold b {
		color: var(--color-resource);
	}
</style>
