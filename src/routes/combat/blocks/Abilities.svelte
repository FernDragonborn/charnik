<script lang="ts">
	// The six ability tiles (score + mod + saving throw). Tapping a tile rolls a check; tapping the
	// SAVE row rolls the save. Reads the `combat` view-model; the derived sheet comes in as a prop.
	import type { CharacterSheet } from '$lib/character/derive';
	import { combat } from '../state.svelte';
	import { why, signed, ABIL } from '$lib/combat/helpers';

	let { s }: { s: CharacterSheet } = $props();
	const collapsed = $derived(combat.layout.collapsed);
	const { toggle } = combat.layout;
	const { roll } = combat;
</script>

<div class="sectlab">
	<button class="slabtoggle" onclick={() => toggle('abilities')}
		><span class="chevron">{collapsed.abilities ? '▸' : '▾'}</span>Abilities</button
	><em>tap to roll a check or save</em>
</div>
{#if !collapsed.abilities}
	<section class="grid">
		{#each ABIL as ab (ab)}
			{@const a = s.abilities[ab]}
			{@const prof = a.save.trace.some((t) => t.layer === 'proficiency')}
			<!-- a tile is NOT a button (it holds two): a check button + a save button, both keyboard-
			     reachable — a nested <button> is invalid HTML and drops the save from the tab order -->
			<div class="ability">
				<button
					type="button"
					class="ability-check"
					onclick={(e) => roll(`${ab.toUpperCase()} check`, a.mod, e)}
				>
					<span class="ability-name" title={why(a.score)}>
						<b>{ab.toUpperCase()}</b> · {a.score.value}
					</span>
					<span class="ability-mod">{signed(a.mod)}</span>
				</button>
				<button
					type="button"
					class="ability-save"
					class:prof
					title={why(a.save)}
					onclick={(e) => roll(`${ab.toUpperCase()} save`, a.save.value, e, `save.${ab}`)}
				>
					<i class="prof-dot" class:on={prof}></i>SAVE <b>{signed(a.save.value)}</b>
				</button>
			</div>
		{/each}
	</section>
{/if}

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 10px;
		margin-bottom: 22px;
	}
	@media (max-width: 640px) {
		.grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	.ability {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 11px;
		padding: 12px 8px;
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
		background: var(--color-surface);
	}
	.ability .ability-name {
		display: block;
		font-family: var(--font-mono);
		font-size: 12px;
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
		text-transform: uppercase;
	}
	.ability .ability-name b {
		color: var(--color-text);
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 13px;
	}
	.ability .ability-mod {
		display: block;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 34px;
		line-height: 1;
		margin: 6px 0 9px;
	}
	.ability .ability-save {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		width: 100%;
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 1;
		color: var(--color-text-muted);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 7px;
		padding: 5px 6px;
		cursor: pointer;
	}
	.ability .ability-save:hover {
		border-color: var(--color-accent);
		background: var(--color-surface-2);
		color: var(--color-text);
	}
	.ability .ability-save b {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 12px;
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
