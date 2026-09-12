<script lang="ts">
	// The "shapka" of a spell article: eyebrow (level · school · edition), title (+ ritual/concentration
	// chips), and the effect/casting strip. Structural stats are read-only; only the title is editable
	// (translate). Prose lives BELOW in ArticleProse; the dispatcher (WikiDetail) stacks them.
	import { _ } from '$lib/i18n';
	import { say, sayText } from '$lib/util/say';
	import type { DetailModel, SpellModel } from '$lib/content/detail';
	import type { WikiEditDraft } from './wikiEdit';
	import DiceIcon from './DiceIcon.svelte';
	import RollButton from './RollButton.svelte';
	import EditableTitle from './EditableTitle.svelte';

	let {
		detail,
		spell,
		editable = false,
		draft,
	}: {
		detail: DetailModel;
		spell: SpellModel;
		editable?: boolean;
		draft?: WikiEditDraft | undefined;
	} = $props();

	/** Has this spell anything to roll? A utility spell had a 116px tile saying "No roll" — a banner
	 *  whose whole content was the absence of content. Without rolls the tile goes and its resolution
	 *  chip joins Ritual / Concentration beside the title, where the other one-word facts already are. */
	const rolls = $derived(!!spell.dice || spell.resChip === 'hit');
</script>

<div class="detail-eyebrow">
	<span class="monster-type">{detail.eyebrow.map((part) => say(part, $_)).join(' · ')}</span>
	<span>{spell.edition}</span>
</div>
<div class="stat-title">
	{#if editable && draft}
		<EditableTitle bind:value={draft.name} placeholder={detail.title} />
	{:else}
		<h1>{detail.title}</h1>
	{/if}
	{#if !rolls}<span class="stat-chip {spell.resChip}">{sayText(spell.resLabel, $_)}</span>{/if}
	{#if spell.ritual}<span class="stat-chip util">{$_('compendium.ritual')}</span>{/if}
	{#if spell.concentration}<span class="stat-chip save">{$_('compendium.concentration')}</span>{/if}
</div>
<div class="strip" class:norolls={!rolls}>
	{#if rolls}
		<div class="spell-effect {spell.resChip}">
			<span class="stat-chip {spell.resChip}">{sayText(spell.resLabel, $_)}</span>
			{#if spell.dice}
				<span class="spell-effect-value">{spell.dice}</span>
				{#if spell.dmgType}<span class="spell-effect-sub">{spell.dmgType}</span>{/if}
			{/if}
			<div class="spell-effect-rolls">
				{#if spell.resChip === 'hit'}
					<RollButton
						formula="1d20"
						label={$_('compendium.rollToHit', { values: { name: detail.title } })}
						><DiceIcon size={14} /> d20</RollButton
					>
				{/if}
				{#if spell.dice}
					<RollButton formula={spell.dice} label={detail.title}
						><DiceIcon size={14} />
						{$_(
							spell.resChip === 'auto' ? 'compendium.rollHeal' : 'compendium.rollDamage',
						)}</RollButton
					>
				{/if}
			</div>
		</div>
	{/if}
	<div class="stat-cells">
		{#each spell.cells as [k, v] (k.key)}
			<div class="stat-cell">
				<div class="stat-key eyebrow">{sayText(k, $_)}</div>
				<div class="stat-value">{say(v, $_)}</div>
			</div>
		{/each}
		{#if spell.availableTo?.length}
			<div class="stat-cell">
				<div class="stat-key eyebrow">{$_('compendium.availableTo')}</div>
				<div class="stat-value">
					{#each spell.availableTo as c, i (c.name)}{i ? ', ' : ''}{c.name}{#if c.homebrew}<span
								class="homebrew-mark"
								title={$_('compendium.grantedClassSide')}>+</span
							>{/if}{/each}
				</div>
			</div>
		{:else if spell.classes}
			<div class="stat-cell">
				<div class="stat-key eyebrow">{$_('compendium.availableTo')}</div>
				<div class="stat-value">{spell.classes}</div>
			</div>
		{/if}
	</div>
</div>

<style>
	h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-h2);
		margin: 0;
	}
	.stat-title {
		display: flex;
		align-items: center;
		gap: var(--space-2-5);
		margin: var(--space-1) 0 14px;
	}
	.stat-chip {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		border-radius: var(--radius-sm);
		padding: 2px var(--space-1-5);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		white-space: nowrap;
	}
	.stat-chip.hit {
		color: var(--color-resource);
		border-color: var(--color-resource-line);
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
		gap: var(--space-3);
		align-items: start;
		margin-bottom: var(--space-1);
	}
	.strip.norolls {
		grid-template-columns: 1fr;
	}
	.spell-effect {
		min-height: 116px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-1-5);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface-2);
		padding: var(--space-3) var(--space-2-5);
		text-align: center;
	}
	.spell-effect-value {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-xl);
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
	.spell-effect-sub {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.spell-effect-rolls {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-1);
	}
	/* auto-fit rather than a fixed pair: the same head is read in a wide compendium pane and in a
	   builder inspector, and the cells should pack to whatever fits instead of squeezing "30 feet
	   (9.1 m)" onto two lines because the column count was decided elsewhere. */
	.stat-cells {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
		gap: var(--space-2);
		align-content: start;
	}
	.stat-cell {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: var(--space-1-5) var(--space-2-5);
	}
	.stat-cell .stat-key {
		font-size: var(--font-size-micro);
	}
	.stat-cell .stat-value {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-body);
		margin-top: 2px;
	}
	.homebrew-mark {
		color: var(--color-resource);
		font-weight: 700;
		margin-inline-start: 1px;
	}
	@container article (max-width: 560px) {
		.strip {
			grid-template-columns: 1fr;
		}
		/* Stacked, the effect tile stops being a 168px column and becomes a ROW. Centring one die and
		   two buttons inside a full-width 116px box put the head's loudest element in a band of empty
		   space — the same "mostly nothing" the list rows had. */
		.spell-effect {
			min-height: 0;
			flex-direction: row;
			justify-content: flex-start;
			gap: var(--space-2-5);
			padding: var(--space-2) var(--space-3);
			text-align: start;
		}
		.spell-effect-rolls {
			margin-inline-start: auto;
		}
	}
</style>
