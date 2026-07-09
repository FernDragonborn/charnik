<script lang="ts">
	// The "shapka" of a spell article: eyebrow (level · school · edition), title (+ ritual/concentration
	// chips), and the effect/casting strip. Structural stats are read-only; only the title is editable
	// (translate). Prose lives BELOW in ArticleProse; the dispatcher (WikiDetail) stacks them.
	import type { DetailModel, SpellModel } from '$lib/content/detail';
	import type { WikiEditDraft } from './wikiEdit';
	import RollButton from './RollButton.svelte';

	let {
		detail,
		spell,
		editable = false,
		draft
	}: {
		detail: DetailModel;
		spell: SpellModel;
		editable?: boolean;
		draft?: WikiEditDraft | undefined;
	} = $props();
</script>

<div class="detail-eyebrow">
	<span class="monster-type">{detail.eyebrow}</span>
	<span>{spell.edition}</span>
</div>
<div class="stat-title">
	{#if editable && draft}
		<input class="edit-title" bind:value={draft.name} placeholder={detail.title} />
	{:else}
		<h1>{detail.title}</h1>
	{/if}
	{#if spell.ritual}<span class="stat-chip util">Ritual</span>{/if}
	{#if spell.concentration}<span class="stat-chip save">Concentration</span>{/if}
</div>
<div class="strip">
	<div class="spell-effect {spell.resChip}">
		<span class="stat-chip {spell.resChip}">{spell.resLabel}</span>
		{#if spell.dice || spell.resChip === 'hit'}
			{#if spell.dice}
				<span class="spell-effect-value">{spell.dice}</span>
				{#if spell.dmgType}<span class="spell-effect-sub">{spell.dmgType}</span>{/if}
			{/if}
			<div class="spell-effect-rolls">
				{#if spell.resChip === 'hit'}
					<RollButton formula="1d20" label={`${detail.title} — to hit`}>🎲 d20</RollButton>
				{/if}
				{#if spell.dice}
					<RollButton formula={spell.dice} label={detail.title}
						>🎲 {spell.resChip === 'auto' ? 'Heal' : 'Dmg'}</RollButton
					>
				{/if}
			</div>
		{:else}
			<span class="spell-effect-value none">No roll</span>
		{/if}
	</div>
	<div class="stat-cells">
		{#each spell.cells as [k, v] (k)}
			<div class="stat-cell">
				<div class="stat-key">{k}</div>
				<div class="stat-value">{v}</div>
			</div>
		{/each}
		{#if spell.availableTo?.length}
			<div class="stat-cell span">
				<div class="stat-key">Available to</div>
				<div class="stat-value">
					{#each spell.availableTo as c, i (c.name)}{i ? ', ' : ''}{c.name}{#if c.homebrew}<span
								class="homebrew-mark"
								title="granted class-side (not on the spell)">+</span
							>{/if}{/each}
				</div>
			</div>
		{:else if spell.classes}
			<div class="stat-cell span">
				<div class="stat-key">Available to</div>
				<div class="stat-value">{spell.classes}</div>
			</div>
		{/if}
	</div>
</div>

<style>
	h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 30px;
		margin: 0;
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
	.stat-title {
		display: flex;
		align-items: center;
		gap: 11px;
		margin: 4px 0 14px;
	}
	.stat-chip {
		font-family: var(--font-mono);
		font-size: 10px;
		border-radius: 5px;
		padding: 2px 7px;
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		white-space: nowrap;
	}
	.stat-chip.hit {
		color: var(--color-resource);
		border-color: #5a4d28;
	}
	.stat-chip.save {
		color: var(--color-accent-bright);
		border-color: var(--color-accent);
	}
	.stat-chip.auto {
		color: var(--color-good);
		border-color: var(--color-good);
	}
	.stat-chip.util {
		color: var(--color-text-muted);
		border-color: var(--color-border-strong);
	}
	.strip {
		display: grid;
		grid-template-columns: 168px 1fr;
		gap: 12px;
		align-items: start;
		margin-bottom: 4px;
	}
	.spell-effect {
		min-height: 116px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6px;
		border: 1px solid var(--color-border-strong);
		border-radius: 12px;
		background: var(--color-surface-2);
		padding: 12px 10px;
		text-align: center;
	}
	.spell-effect-value {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 28px;
		line-height: 1;
	}
	.spell-effect.save .spell-effect-value {
		color: var(--color-accent-bright);
	}
	.spell-effect.hit .spell-effect-value {
		color: var(--color-resource);
	}
	.spell-effect.auto .spell-effect-value {
		color: var(--color-good);
	}
	.spell-effect-value.none {
		color: var(--color-text-muted);
		font-size: 18px;
	}
	.spell-effect-sub {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
	}
	.spell-effect-rolls {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 5px;
	}
	.stat-cells {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		align-content: start;
	}
	.stat-cell {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 9px;
		padding: 7px 11px;
	}
	.stat-cell.span {
		grid-column: span 2;
	}
	.stat-cell .stat-key {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.stat-cell .stat-value {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 14px;
		margin-top: 2px;
	}
	.homebrew-mark {
		color: var(--color-resource);
		font-weight: 700;
		margin-left: 1px;
	}
	@media (max-width: 560px) {
		.strip {
			grid-template-columns: 1fr;
		}
	}
</style>
