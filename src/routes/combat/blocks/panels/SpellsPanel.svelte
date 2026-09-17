<script lang="ts">
	// Spells panel body: per-class cast line (save DC / attack), an armor-block warning, then spell
	// groups with slot pips and rows (prepare toggle, pin, ritual-cast badge, cast on click).
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import { abilityShortLabel } from '$lib/util/format';
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
			{/if}{$_('combat.spells.saveDc')}
			<b use:provenance={why(sc.saveDC, $_)}>{sc.saveDC.value}</b>
			· {$_('combat.spells.attackBonus')}
			<b use:provenance={why(sc.attack, $_)}>{signed(sc.attack.value)}</b>
		{/each}
		{#if !multi}
			{$_('combat.spells.everySpell')}{/if}
	</div>
	{#if combat.armorBlock}
		<!-- the `title` stays the rules note verbatim: it is the same sentence Content health shows for
		     this block, and that copy is its own i18n domain (docs/internals/ui.md ▸ Error copy) -->
		<div
			class="armor-block"
			title={$_('combat.spells.armorBlockNote', {
				values: { category: $_(`armorCategory.${combat.armorBlock.category}`) },
			})}
		>
			<Icon name="triangle-alert" size={13} />
			{$_('combat.spells.castingBlocked', { values: { armor: combat.armorBlock.source } })}
		</div>
	{/if}
	<div class="spell-rows">
		{#each spellGroups as g (g.key)}
			<div class="spgroup">
				<div class="spell-category eyebrow" class:star={g.key === 'pinned'}>
					{g.labelKey
						? $_(g.labelKey, {
								default: g.label,
								...(g.labelValues ? { values: g.labelValues } : {}),
							})
						: g.label}
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
					<!-- the row is a DIV and each control on it is a real `<button>`: they used to be spans and
					     `<i>`s inside one row-button, which is invalid nested interactive content and the reason
					     Tab went row, row, out — prepare, pin, ritual cast and the cast-time note were
					     reachable by mouse only, and ritual casting by nothing else anywhere in the app. The
					     NAME is the cast button, so the widest cell of the row still casts on a click. -->
					<div class="spell-row">
						<span class="row-name">
							<button
								class="prep"
								class:on={r.prepState === 'on'}
								class:always={r.prepState === 'always'}
								title={$_(
									r.prepState === 'always'
										? 'combat.spells.alwaysPrepared'
										: 'combat.spells.togglePrepared',
								)}
								aria-pressed={r.prepState === 'on' || r.prepState === 'always'}
								onclick={() => togglePrepared(r)}
							></button>
							<button class="name-cast" onclick={(e) => cast(r, e)}
								><span class="name-main">{r.name}</span></button
							>
							<button
								class="pin-star"
								class:on={pinned[r.ref]}
								title={$_('combat.spells.pinToTop')}
								aria-pressed={!!pinned[r.ref]}
								onclick={() => combat.togglePin(r.ref)}
								><Icon
									name="star"
									size={13}
									fill={pinned[r.ref] ? 'currentColor' : 'none'}
								/></button
							>
							{#if r.ritual && s.spellcasting.ritualCasting}
								<!-- ritual cast: no spell slot (A17). Only shown when the character HAS ritual casting
								     (E7 — Wizard/Cleric/Druid/Bard; not base Warlock). The name casts normally. -->
								<button
									class="ritual-cast"
									title={$_('combat.spells.castRitual')}
									onclick={(e) => cast(r, e, { ritual: true })}>R</button
								>
							{/if}
						</span>
						<span class="spell-summary">{r.summary}</span>
						{#if r.resolution}<span class="resolution-tag {r.resolution}"
								>{$_(r.resolutionLabelKey, {
									...(r.resolutionAbility
										? { values: { ability: abilityShortLabel(r.resolutionAbility, $_) } }
										: {}),
								})}</span
							>{:else}<span></span>{/if}
						<span class="spell-level"
							>{#if r.castTimeIcon}{@const when = $_(
									r.castTimeIcon === 'react'
										? 'combat.spells.reaction'
										: 'combat.spells.bonusAction',
								)}<button
									class="cast-icon"
									title={when}
									onclick={() => toast($_('combat.notice.castingTime', { values: { when } }))}
									><Icon
										name={r.castTimeIcon === 'react' ? 'corner-down-left' : 'zap'}
										size={12}
									/></button
								>{/if}{#if r.level > 0 && combat.castableSlots(r).length > 1}<!-- upcast picker: a leveled spell with >1 open slot level can be cast higher (item 1) --><button
									class="upcast-btn"
									aria-label={$_('combat.spells.castUpcast')}
									use:provenance={[$_('combat.spells.castUpcast'), combat.upcastLadder(r, $_)]
										.filter(Boolean)
										.join('\n')}
									onclick={(e) => combat.openUpcast(r, e)}
									><Icon name="arrow-up" size={12} /></button
								>{/if}{$_(r.levelTagKey, {
								...(r.levelTagValues ? { values: r.levelTagValues } : {}),
							})}</span
						>
					</div>
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
		position: relative;
		display: grid;
		/* fixed columns so effect/tag/timing line up across rows even when a row has no
		   resolution pill (its cell stays empty but keeps its width) */
		grid-template-columns: minmax(0, 1fr) 76px 74px 46px;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1-5) var(--space-1-5);
		border-top: 1px solid var(--color-border);
		border-radius: var(--radius);
		break-inside: avoid;
		width: 100%;
		color: var(--color-text);
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
	/* the cast target. It takes its CONTENT's width and no more: the pin star sits immediately after
	   the name (ui.md §11 — a row's own state hugs the name it belongs to), and a cast button that
	   stretched pushed the star to the far side of the cell. */
	.spell-row .name-cast {
		min-width: 0;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	/* …and its CLICK still covers the whole row. Casting used to be a press anywhere on the row, and
	   making the row a div — the fix for nested interactive content — left every part of it but the
	   name dead. An overlay owned by the cast button gives that area back without a second control:
	   it paints UNDER the row's other buttons (they carry `z-index: 1`), so prepare, pin, ritual and
	   upcast keep their own presses, and the keyboard still meets exactly one cast target. */
	.spell-row .name-cast::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 0;
	}
	.spell-row .prep,
	.spell-row .pin-star,
	.spell-row .ritual-cast,
	.spell-row .spell-level .cast-icon,
	.spell-row .spell-level .upcast-btn {
		position: relative;
		z-index: 1;
	}
	.spell-row .row-name .name-main {
		display: block;
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
		margin-inline-end: var(--space-1-5);
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--color-accent-bright);
		cursor: help;
	}
	/* upcast affordance (⇡): opens the slot-picker. Dim until the row is hovered/focused so it doesn't
	   clutter, then reads as clickable (interactive-affordance invariant). */
	.spell-row .spell-level .upcast-btn {
		display: inline-block;
		margin-inline-end: var(--space-1);
		padding: 0 var(--space-1);
		border: 0;
		border-radius: var(--radius-xs);
		background: transparent;
		color: var(--color-resource);
		opacity: 0;
		cursor: pointer;
		transition: opacity 0.12s;
	}
	/* it is invisible until the row is hovered, so a keyboard that lands on it must bring it back —
	   otherwise Tab stops on something nobody can see */
	.spell-row .spell-level .upcast-btn:focus-visible {
		opacity: 1;
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
		padding: 0;
		border-radius: 50%;
		border: 1.5px solid var(--color-border-strong);
		background: transparent;
		margin-inline-end: var(--space-2);
		vertical-align: middle;
		cursor: pointer;
		flex: none;
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
		border-radius: var(--radius-xs);
		color: var(--color-danger);
		font-size: 0.85em;
	}
	/* ritual-cast badge — only on ritual-tagged spells; casts with no slot */
	.ritual-cast {
		flex: none;
		background: transparent;
		margin-inline-start: var(--space-1-5);
		padding: 0 var(--space-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xs);
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
