<script lang="ts">
	// The hit-point block on its feet: the number and its bar, the hit on the number's own line, and
	// healing behind one green control. One height in every state — nothing appears INSIDE the block.
	import type { Snippet } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import { provenance } from '$lib/actions/provenance';
	import { why } from '$lib/combat/helpers';
	import type { Character } from '$lib/character/schema';
	import type { CharacterSheet } from '$lib/character/derive';
	import { combat } from '../../combat-view-model.svelte';
	import HitLine from './HitLine.svelte';

	let { c, s, pencil }: { c: Character; s: CharacterSheet; pencil: Snippet } = $props();
	const hpBar = $derived(combat.hpBar);
	const { openMenu } = combat;
</script>

<div class="hp-face standing">
	<div class="hp-label">
		<span class="eyebrow">{$_('combat.hp.hitPoints')}</span>{@render pencil()}
	</div>
	<!-- healing and temporary hit points are one green control: a type beside a Heal reads as a kind
	     of heal, so nothing about damage stands in this corner -->
	<button
		type="button"
		class="hp-heal"
		aria-label={$_('combat.hp.healOrTemp')}
		onclick={(event) => openMenu('restore', event)}
	>
		<Icon name="plus" size={13} /><span class="hp-heal-words">{$_('combat.hp.healOrTemp')}</span>
	</button>
	<div class="hp-value" use:provenance={why(s.maxHp, $_)}>
		{c.play.hp.current}<small>&nbsp;/ {combat.hpMax}</small>{#if c.play.hp.temp > 0}<span
				class="temp">+{c.play.hp.temp} {$_('combat.hp.temp')}</span
			>{/if}
	</div>
	<div class="hp-hit"><HitLine /></div>
	<div class="hp-bar">
		<i class="hp-bar-current" style="width:{hpBar.cur}%"></i><i
			class="hp-bar-temp"
			style="width:{hpBar.tmp}%"
		></i>
	</div>
</div>

<style>
	.hp-face.standing {
		display: grid;
		grid-template:
			'label heal' auto
			'value hit' 1fr
			'bar bar' auto / 1fr auto;
		align-items: center;
		column-gap: var(--space-2);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-3) var(--space-4);
	}
	.hp-label {
		grid-area: label;
		display: flex;
		align-items: center;
		color: var(--color-text-muted);
	}
	.hp-heal {
		grid-area: heal;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-full);
		border: 1px solid var(--color-good);
		background: var(--color-good-soft);
		color: var(--color-good);
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-xs);
		white-space: nowrap;
		cursor: pointer;
	}
	.hp-heal:hover {
		filter: brightness(1.14);
	}
	.hp-value {
		grid-area: value;
		min-width: 0;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-h2);
		line-height: 1.1;
		white-space: nowrap;
	}
	.hp-value small {
		color: var(--color-text-muted);
		font-size: var(--font-size-md);
		font-weight: 500;
	}
	.hp-value .temp {
		font-weight: 600;
		font-size: var(--font-size-body);
		color: var(--color-good);
		margin-inline-start: var(--space-1-5);
	}
	.hp-hit {
		grid-area: hit;
		display: flex;
		justify-content: flex-end;
	}
	.hp-bar {
		grid-area: bar;
		display: flex;
		height: 9px;
		border-radius: var(--radius-full);
		background: var(--color-surface-2);
		overflow: hidden;
		border: 1px solid var(--color-border);
	}
	.hp-bar > i {
		display: block;
		height: 100%;
	}
	.hp-bar-current {
		background: var(--color-accent);
	}
	.hp-bar-temp {
		background: var(--color-good);
		box-shadow: -1px 0 0 var(--color-surface);
	}

	/* ---- a narrow block: the number, the bar, then one row of what is pressed — the hit's field,
	   the minus, and healing as its plus ---- */
	@container hp-block (max-width: 26rem) {
		.hp-face.standing {
			grid-template:
				'label label' auto
				'value value' auto
				'bar bar' auto
				'hit heal' 1fr / 1fr auto;
			row-gap: var(--space-1-5);
			align-items: end;
		}
		.hp-hit {
			display: block;
			min-width: 0;
		}
		.hp-heal {
			min-width: 2.75rem;
			min-height: 2.75rem;
			padding: 0;
			border-radius: var(--radius);
		}
		.hp-heal-words {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}
</style>
