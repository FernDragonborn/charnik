<script lang="ts">
	// The "shapka" of a monster stat block: eyebrow, title, the vitals + abilities panels, and the
	// senses/defenses band. Structural stats are read-only; only the title is editable (translate).
	import { toast } from 'svelte-sonner';
	import { rollFormula } from '$lib/rules/dice';
	import type { DetailModel, MonsterModel } from '$lib/content/detail';
	import type { WikiEditDraft } from './wikiEdit';

	let {
		detail,
		monster,
		editable = false,
		draft
	}: {
		detail: DetailModel;
		monster: MonsterModel;
		editable?: boolean;
		draft?: WikiEditDraft | undefined;
	} = $props();

	const rollHp = (formula: string) =>
		toast(`HP rolled — ${rollFormula(formula).total}`, { description: formula });
</script>

<div class="detail-eyebrow">
	<span>Monster</span>
	<span><span class="monster-type">{monster.type}</span> · {monster.edition}</span>
</div>
{#if editable && draft}
	<input class="edit-title" bind:value={draft.name} placeholder={detail.title} />
{:else}
	<h1>{detail.title}</h1>
{/if}
<div class="content-cols">
	<div class="detail-panel">
		<div class="panel-header">Vitals</div>
		<div class="value-row challenge-rating">
			<span class="value-key">CR</span><span class="challenge-rating-value"
				>{monster.cr || '—'}</span
			>
		</div>
		{#if monster.ac}<div class="value-row">
				<span class="value-key">AC</span><span>{monster.ac}</span>
			</div>{/if}
		{#if monster.initiative}<div class="value-row">
				<span class="value-key">Initiative</span><span>{monster.initiative}</span>
			</div>{/if}
		{#if monster.hp}
			<div class="value-row">
				<span class="value-key">HP</span>
				<span>
					{monster.hp}
					{#if monster.hpFormula}<span class="dim">{monster.hpFormula}</span>
						<button class="hp-dice" title="Roll HP" onclick={() => rollHp(monster.hpFormula)}
							>🎲</button
						>{/if}
				</span>
			</div>
		{/if}
		{#if monster.speed}<div class="value-row">
				<span class="value-key">Speed</span><span>{monster.speed}</span>
			</div>{/if}
	</div>
	<div class="detail-panel">
		<div class="panel-header">Abilities</div>
		<div class="ability-row head" class:has-save={monster.hasSaves}>
			<span></span><span>score</span><span>mod</span>{#if monster.hasSaves}<span>save</span>{/if}
		</div>
		{#each monster.abilities as a (a.ab)}
			<div class="ability-row" class:has-save={monster.hasSaves}>
				<span class="ab-n">{a.ab}</span>
				<span>{a.score}</span>
				<span class="amod">{a.mod}</span>
				{#if monster.hasSaves}<span class="ability-save">{a.save ?? a.mod}</span>{/if}
			</div>
		{/each}
	</div>
</div>
{#if monster.band.length || monster.defenses.length}
	<div class="band">
		{#each monster.band as [k, v] (k)}
			<div class="band-row">
				<span class="band-key">{k}</span><span class="band-value">{v}</span>
			</div>
		{/each}
		{#each monster.defenses as [k, v] (k)}
			<div class="band-row defenses">
				<span class="band-key">{k}</span><span class="band-value">{v}</span>
			</div>
		{/each}
	</div>
{/if}

<style>
	h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 30px;
		margin: 6px 0 12px;
	}
	.edit-title {
		width: 100%;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 28px;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: 8px;
		color: var(--color-text);
		padding: 4px 10px;
		margin: 4px 0 12px;
	}
	.edit-title:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.detail-eyebrow {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.16em;
		font-size: 11px;
		color: var(--color-text-muted);
	}
	.detail-eyebrow .monster-type {
		color: var(--color-accent-bright);
	}
	.content-cols {
		display: grid;
		grid-template-columns: 1fr 1.2fr;
		gap: 12px;
		margin-bottom: 12px;
	}
	.detail-panel {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 11px;
		padding: 11px 14px;
	}
	.panel-header {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin-bottom: 6px;
	}
	.value-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 10px;
		padding: 5px 0;
		border-top: 1px solid var(--color-border);
		font-family: var(--font-mono);
		font-size: 13px;
	}
	.value-row:first-of-type {
		border-top: 0;
	}
	.value-row .value-key {
		color: var(--color-text-muted);
	}
	.value-row .dim {
		color: var(--color-text-muted);
	}
	.value-row.challenge-rating {
		padding: 2px 0 6px;
	}
	.value-row.challenge-rating .value-key {
		align-self: center;
	}
	.value-row.challenge-rating .challenge-rating-value {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 26px;
		color: var(--color-accent-bright);
	}
	.hp-dice {
		border: 0;
		background: transparent;
		color: var(--color-accent-bright);
		cursor: pointer;
		font-size: 12px;
		padding: 0 0 0 2px;
	}
	.ability-row {
		display: grid;
		grid-template-columns: 42px 1fr 1fr;
		gap: 6px;
		padding: 4px 0;
		border-top: 1px solid var(--color-border);
		align-items: baseline;
		font-family: var(--font-mono);
		font-size: 13px;
	}
	.ability-row.has-save {
		grid-template-columns: 42px 1fr 1fr 1fr;
	}
	.ability-row:first-of-type {
		border-top: 0;
	}
	.ability-row.head {
		color: var(--color-text-muted);
		font-size: 10px;
	}
	.ability-row .ab-n {
		color: var(--color-accent-bright);
		font-family: var(--font-display);
		font-weight: 600;
	}
	.ability-row .ability-save {
		color: var(--color-good);
	}
	.band {
		border: 1px solid var(--color-border);
		border-radius: 11px;
		padding: 2px 14px;
		margin-bottom: 4px;
	}
	.band-row {
		display: flex;
		gap: 12px;
		padding: 6px 0;
		border-top: 1px solid var(--color-border);
		font-size: 13px;
	}
	.band-row:first-child {
		border-top: 0;
	}
	.band-row .band-key {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		min-width: 96px;
		flex: none;
		padding-top: 2px;
	}
	.band-row .band-value {
		font-family: var(--font-mono);
		font-size: 13px;
	}
	.band-row.defenses .band-value {
		color: var(--color-accent-bright);
	}
	@media (max-width: 560px) {
		.content-cols {
			grid-template-columns: 1fr;
		}
	}
</style>
