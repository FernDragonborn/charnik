<script lang="ts">
	// The Combat stat strip: collapsible section with AC / Initiative / Speed tiles, the passive-
	// senses row (with Pin skills), and the defenses row (resist/immune/vulnerable). Reads the
	// `combat` view-model; the derived sheet comes in as a prop.
	import type { CharacterSheet } from '$lib/character/derive';
	import { combat } from '../state.svelte';
	import { why, signed, metres } from '$lib/combat/helpers';

	let { s }: { s: CharacterSheet } = $props();
	const passives = $derived(combat.passives);
	const collapsed = $derived(combat.layout.collapsed);
	const { toggle } = combat.layout;
	const { roll, openMenu } = combat;
</script>

<div class="sectlab">
	<button class="slabtoggle" onclick={() => toggle('combat')}
		><span class="chevron">{collapsed.combat ? '▸' : '▾'}</span>Combat</button
	>
</div>
{#if !collapsed.combat}
	<section class="combat">
		<button class="tile" title={why(s.ac)} onclick={(e) => roll('AC (touch)', 0, e)}>
			<div class="tile-key">Armor class</div>
			<div class="tile-value">{s.ac.value}</div>
			<div class="tile-text">
				{s.ac.trace.map((x) => `${x.source} ${signed(x.amount)}`).join(' ')}
			</div>
		</button>
		<button
			class="tile"
			title={why(s.initiative)}
			onclick={(e) => roll('Initiative', s.initiative.value, e, 'initiative')}
		>
			<div class="tile-key">Initiative</div>
			<div class="tile-value">{signed(s.initiative.value)}</div>
			<div class="tile-text">DEX <b>{signed(s.abilities.dex.mod)}</b></div>
		</button>
		<div class="tile" title={why(s.speed)}>
			<div class="tile-key">Speed</div>
			<div class="tile-value">{s.speed.value} ft<small> ({metres(s.speed.value)})</small></div>
			<div class="tile-text">base walk</div>
		</div>
	</section>
	<div class="senses-strip">
		<span class="bar-label">Passive senses</span>
		{#each passives as p, i (p.key)}
			{#if i > 0}<span class="separator-dot">·</span>{/if}
			<span class="ability-save" title={why(p.comp)}><i>{p.name}</i>{p.comp.value}</span>
		{:else}
			<span class="ability-save"><i>none pinned</i></span>
		{/each}
		<button class="edit" onclick={(e) => openMenu('pinskills', e)}>✎ Pin skills</button>
	</div>
	{#if s.defenses.resist.length || s.defenses.immune.length || s.defenses.vulnerable.length}
		<div class="senses-strip">
			<span class="bar-label">Defenses</span>
			{#if s.defenses.resist.length}<span class="ability-save"
					><i>Resist</i>{s.defenses.resist.join(', ')}</span
				>{/if}
			{#if s.defenses.immune.length}<span class="ability-save"
					><i>Immune</i>{s.defenses.immune.join(', ')}</span
				>{/if}
			{#if s.defenses.vulnerable.length}<span class="ability-save"
					><i>Vulnerable</i>{s.defenses.vulnerable.join(', ')}</span
				>{/if}
		</div>
	{/if}
{/if}

<style>
	.combat {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
		margin-bottom: 12px;
	}
	.tile {
		text-align: left;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: 13px;
		padding: 13px 15px;
		color: var(--color-text);
	}
	button.tile {
		cursor: pointer;
	}
	/* only the clickable tiles (AC / Init) light up; the Speed tile is a plain div */
	button.tile:hover {
		border-color: var(--color-accent);
		background: var(--color-surface-2);
	}
	.tile .tile-key {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-accent-bright);
	}
	.tile .tile-value {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 26px;
		line-height: 1.05;
		margin-top: 4px;
	}
	.tile .tile-value small {
		font-size: 13px;
		color: var(--color-text-muted);
		font-weight: 500;
	}
	.tile .tile-text {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
		margin-top: 6px;
	}
	.tile .tile-text b {
		color: var(--color-resource);
	}

	.senses-strip {
		display: flex;
		align-items: baseline;
		gap: 14px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 11px 16px;
		margin-bottom: 22px;
	}
	.senses-strip .bar-label {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.senses-strip .ability-save {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 16px;
	}
	.senses-strip .ability-save i {
		font-style: normal;
		font-family: var(--font-body);
		font-weight: 400;
		font-size: 12px;
		color: var(--color-text-muted);
		margin-right: 6px;
	}
	.senses-strip .separator-dot {
		color: var(--color-border-strong);
	}
	.senses-strip .edit {
		margin-left: auto;
		font-family: var(--font-body);
		font-size: 12px;
		color: var(--color-text-muted);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		padding: 3px 8px;
		cursor: pointer;
		align-self: center;
	}
	.senses-strip .edit:hover {
		color: var(--color-text);
		border-color: var(--color-border-strong);
		background: var(--color-surface-2);
	}
</style>
