<script lang="ts">
	// Spells panel body: per-class cast line (save DC / attack), an armor-block warning, then spell
	// groups with slot pips and rows (prepare toggle, pin, ritual-cast badge, cast on click).
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import { toast } from 'svelte-sonner';
	import type { CharacterSheet } from '$lib/character/derive';
	import { combat } from '../../combat-view-model.svelte';
	import { why, signed, range } from '$lib/combat/helpers';
	import { provenance } from '$lib/actions/provenance';

	let { s }: { s: CharacterSheet } = $props();
	const spellGroups = $derived(combat.spellGroups);
	const pinned = $derived(combat.pinned);
	const { cast, togglePrepared } = combat;
	const { slotClick } = combat.resources;
</script>

{#if s.spellcasting.classes.length}
	{@const multi = s.spellcasting.classes.length > 1}
	<div class="cast-line">
		{#each s.spellcasting.classes as sc, i (sc.className)}
			{#if i > 0}<span class="cast-separator"> · </span>{/if}
			{#if multi}<b class="cast-class">{sc.className}</b>
			{/if}Save DC
			<b use:provenance={why(sc.saveDC)}>{sc.saveDC.value}</b> · attack
			<b use:provenance={why(sc.attack)}>{signed(sc.attack.value)}</b>
		{/each}
		{#if !multi}
			— every spell{/if}
	</div>
	{#if combat.armorBlock}
		<div class="armor-block" title={combat.armorBlock.note}>
			<Icon name="triangle-alert" size={13} /> Spellcasting blocked — not proficient with {combat
				.armorBlock.source}
		</div>
	{/if}
	<div class="spell-rows">
		{#each spellGroups as g (g.key)}
			<div class="spgroup">
				<div class="spell-category eyebrow" class:star={g.key === 'pinned'}>
					{g.label}
					{#if g.slots}{@const sl = g.slots}<span class="pips"
							>{#each range(sl.full) as i (i)}<button
									class="slot-pip"
									class:full={i < sl.full - sl.spent}
									class:spent={i >= sl.full - sl.spent}
									title={$_('combat.spells.slotPip')}
									onclick={() => slotClick(g.key, sl.full, sl.spent, i)}
								></button>{/each}</span
						>{/if}
				</div>
				{#each g.rows as r (g.key + r.id)}
					<button class="spell-row" onclick={(e) => cast(r, e)}>
						<span class="row-name">
							<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
							<i
								class="prep"
								class:on={r.prepState === 'on'}
								class:always={r.prepState === 'always'}
								title={$_(
									r.prepState === 'always'
										? 'combat.spells.alwaysPrepared'
										: 'combat.spells.togglePrepared',
								)}
								onclick={(e) => {
									e.stopPropagation();
									togglePrepared(r);
								}}
							></i>
							<span class="name-main">{r.name}</span>
							<span
								class="pin-star"
								class:on={pinned[r.id]}
								role="button"
								tabindex="-1"
								title={$_('combat.spells.pinToTop')}
								onclick={(e) => {
									e.stopPropagation();
									combat.togglePin(r.id);
								}}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										e.stopPropagation();
										combat.togglePin(r.id);
									}
								}}
								><Icon name="star" size={13} fill={pinned[r.id] ? 'currentColor' : 'none'} /></span
							>
							{#if r.ritual && s.spellcasting.ritualCasting}
								<!-- ritual cast: no spell slot (A17). Only shown when the character HAS ritual casting
								     (E7 — Wizard/Cleric/Druid/Bard; not base Warlock). Row-click casts normally. -->
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<span
									class="ritual-cast"
									role="button"
									tabindex="-1"
									title={$_('combat.spells.castRitual')}
									onclick={(e) => {
										e.stopPropagation();
										cast(r, e, { ritual: true });
									}}>R</span
								>
							{/if}
						</span>
						<span class="spell-summary">{r.summary}</span>
						{#if r.resolution}<span class="resolution-tag {r.resolution}">{r.resolutionLabel}</span
							>{:else}<span></span>{/if}
						<span class="spell-level"
							>{#if r.castTimeIcon}<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions --><i
									class="cast-icon"
									title={$_(
										r.castTimeIcon === 'react'
											? 'combat.spells.reaction'
											: 'combat.spells.bonusAction',
									)}
									onclick={(e) => {
										e.stopPropagation();
										toast(
											$_('combat.notice.castingTime', {
												values: {
													when: $_(
														r.castTimeIcon === 'react'
															? 'combat.spells.reaction'
															: 'combat.spells.bonusAction',
													),
												},
											}),
										);
									}}
									><Icon
										name={r.castTimeIcon === 'react' ? 'corner-down-left' : 'zap'}
										size={12}
									/></i
								>{/if}{#if r.level > 0 && combat.castableSlots(r).length > 1}<!-- upcast picker: a leveled spell with >1 open slot level can be cast higher (item 1) --><!-- svelte-ignore a11y_click_events_have_key_events --><span
									class="upcast-btn"
									role="button"
									tabindex="-1"
									title={$_('combat.spells.castUpcast')}
									onclick={(e) => {
										e.stopPropagation();
										combat.openUpcast(r, e);
									}}><Icon name="arrow-up" size={12} /></span
								>{/if}{r.levelTag}</span
						>
					</button>
				{/each}
			</div>
		{/each}
	</div>
{/if}

<style>
	.cast-line {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin: -2px 0 var(--space-2);
	}
	.cast-line b {
		color: var(--color-resource);
		font-family: var(--font-display);
		font-weight: 700;
	}
	.cast-line b.cast-class {
		color: var(--color-accent-bright);
	}
	.cast-separator {
		color: var(--color-border-strong);
	}
	.spell-rows {
		margin-top: 2px;
	}
	/* mono/uppercase/tracking/muted come from the shared .eyebrow primitive; keep layout + micro size */
	.spell-category {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-micro);
		padding: var(--space-2-5) 0 var(--space-1);
		break-inside: avoid;
	}
	.spell-category.star {
		color: var(--color-accent-bright);
	}
	.spell-category .pips {
		display: flex;
		gap: var(--space-1);
	}
	.spell-category .slot-pip {
		width: 12px;
		height: 12px;
		padding: 0;
		border-radius: 50%;
		border: 1px solid var(--color-good-line);
		cursor: pointer;
	}
	.spell-category .slot-pip.full {
		background: var(--color-good);
		border-color: var(--color-good);
		box-shadow: 0 0 8px color-mix(in srgb, var(--color-good) 45%, transparent);
	}
	.spell-category .slot-pip.spent {
		background: transparent;
		border-style: dashed;
		opacity: 0.5;
	}
	.spell-row {
		display: grid;
		/* fixed columns so effect/tag/timing line up across rows even when a row has no
		   resolution pill (its cell stays empty but keeps its width) */
		grid-template-columns: minmax(0, 1fr) 76px 74px 46px;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1-5) var(--space-1-5);
		border-top: 1px solid var(--color-border);
		border-radius: 7px;
		cursor: pointer;
		break-inside: avoid;
		width: 100%;
		background: transparent;
		border-inline-start: 0;
		border-inline-end: 0;
		border-bottom: 0;
		color: var(--color-text);
		text-align: start;
		font: inherit;
	}
	.spgroup:first-child .spell-category {
		padding-top: 2px;
	}
	.spell-row:hover {
		background: var(--color-surface-2);
	}
	.spell-row .row-name {
		min-width: 0;
		display: flex;
		align-items: center;
		gap: var(--space-1-5);
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
	.spell-row .row-name .name-main {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.spell-row .pin-star {
		flex: none;
	}
	.spell-row .spell-summary {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		font-weight: 600;
		white-space: nowrap;
		text-align: end;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.spell-row .resolution-tag {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		border-radius: var(--radius-sm);
		padding: 2px var(--space-1);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		white-space: nowrap;
		text-align: center;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.spell-row .resolution-tag.hit {
		color: var(--color-resource);
		border-color: var(--color-resource-line);
	}
	.spell-row .resolution-tag.save {
		color: var(--color-accent-bright);
		border-color: var(--color-accent);
	}
	.spell-row .resolution-tag.auto {
		color: var(--color-good);
		border-color: var(--color-good);
	}
	.spell-row .spell-level {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		text-align: end;
		white-space: nowrap;
	}
	.spell-row .spell-level .cast-icon {
		font-style: normal;
		margin-inline-end: var(--space-1-5);
		color: var(--color-accent-bright);
		cursor: help;
	}
	/* upcast affordance (⇡): opens the slot-picker. Dim until the row is hovered/focused so it doesn't
	   clutter, then reads as clickable (interactive-affordance invariant). */
	.spell-row .spell-level .upcast-btn {
		display: inline-block;
		margin-inline-end: var(--space-1);
		padding: 0 var(--space-1);
		border-radius: 4px;
		color: var(--color-resource);
		opacity: 0;
		cursor: pointer;
		transition: opacity 0.12s;
	}
	.spell-row:hover .spell-level .upcast-btn,
	.spell-row:focus-within .spell-level .upcast-btn {
		opacity: 0.85;
	}
	.spell-row .spell-level .upcast-btn:hover {
		opacity: 1;
		background: var(--color-resource-soft);
	}
	.prep {
		position: relative;
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		border: 1.5px solid var(--color-border-strong);
		margin-inline-end: var(--space-2);
		vertical-align: middle;
		cursor: pointer;
	}
	/* big invisible click target so the tiny dot is easy to hit */
	.prep::before {
		content: '';
		position: absolute;
		inset: -14px;
		border-radius: 50%;
	}
	/* hover halo (~2.5× the dot), painted behind it, showing you're on the prep target */
	.prep:hover {
		box-shadow: 0 0 0 6px var(--color-border-strong);
	}
	.prep.always {
		cursor: default;
	}
	.prep.on,
	.prep.always {
		background: var(--color-resource);
		border-color: var(--color-resource);
	}
	.pin-star {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		background: transparent;
		border: 0;
		color: var(--color-border-strong);
		margin-inline-start: var(--space-1);
		cursor: pointer;
		font-size: var(--font-size-xs);
		line-height: 1;
		border-radius: 50%;
	}
	/* big invisible click target so the star is easy to hit (same trick as the prep dot) */
	.pin-star::before {
		content: '';
		position: absolute;
		inset: calc(-1 * var(--space-1-5));
		border-radius: 50%;
	}
	/* hover = a FILLED disc behind the star (bg + halo of the same colour, so it's a solid circle, not
	   a donut). The icon itself never changes colour — a pinned (filled) star stays gold, an unpinned one stays
	   dim — only the disc appears behind it. */
	.pin-star:hover {
		background: var(--color-border);
		box-shadow: 0 0 0 2px var(--color-border);
	}
	.pin-star.on {
		color: var(--color-accent-bright);
	}
	/* B9: worn non-proficient armor blocks spellcasting (RAW rule-block) */
	.armor-block {
		margin: var(--space-1) 0 var(--space-1-5);
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--color-danger);
		border-radius: 4px;
		color: var(--color-danger);
		font-size: 0.85em;
	}
	/* ritual-cast badge — only on ritual-tagged spells; casts with no slot */
	.ritual-cast {
		margin-inline-start: var(--space-1-5);
		padding: 0 var(--space-1);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		line-height: 15px;
		cursor: pointer;
	}
	.ritual-cast:hover {
		color: var(--color-accent-bright);
		border-color: var(--color-accent-bright);
	}
</style>
