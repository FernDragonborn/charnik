<script lang="ts">
	// Spells panel body: per-class cast line (save DC / attack), an armor-block warning, then spell
	// groups with slot pips and rows (prepare toggle, pin, ritual-cast badge, cast on click).
	import { toast } from 'svelte-sonner';
	import type { CharacterSheet } from '$lib/character/derive';
	import { combat } from '../../state.svelte';
	import { why, signed } from '$lib/combat/helpers';

	let { s }: { s: CharacterSheet } = $props();
	const spellGroups = $derived(combat.spellGroups);
	const pinned = $derived(combat.pinned);
	const { cast, togglePrepared } = combat;
	const { slotClick } = combat.resources;
</script>

{#if s.spellcasting.classes.length}
	{@const multi = s.spellcasting.classes.length > 1}
	<div class="castline">
		{#each s.spellcasting.classes as sc, i (sc.className)}
			{#if i > 0}<span class="castsep"> · </span>{/if}
			{#if multi}<b class="castcls">{sc.className}</b>
			{/if}Save DC
			<b title={why(sc.saveDC)}>{sc.saveDC.value}</b> · attack
			<b>{signed(sc.attack.value)}</b>
		{/each}
		{#if !multi}
			— every spell{/if}
	</div>
	{#if combat.armorBlock}
		<div class="armor-block" title={combat.armorBlock.note}>
			⚠ Spellcasting blocked — not proficient with {combat.armorBlock.source}
		</div>
	{/if}
	<div class="spell-rows">
		{#each spellGroups as g (g.key)}
			<div class="spgroup">
				<div class="spell-category" class:star={g.key === 'pinned'}>
					{g.label}
					{#if g.slots}{@const sl = g.slots}<span class="pips"
							>{#each Array(sl.full) as _, i (i)}<button
									class="slot-pip"
									class:full={i < sl.full - sl.spent}
									class:spent={i >= sl.full - sl.spent}
									title="tap to spend / restore"
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
								class:on={r.prep === 'on'}
								class:always={r.prep === 'always'}
								title={r.prep === 'always' ? 'always prepared' : 'tap to prepare / unprepare'}
								onclick={(e) => {
									e.stopPropagation();
									togglePrepared(r);
								}}
							></i>
							<span class="name-main">{r.name}</span>
							<span
								class="pinstar"
								class:on={pinned[r.id]}
								role="button"
								tabindex="-1"
								title="pin to top"
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
								}}>{pinned[r.id] ? '★' : '☆'}</span
							>
							{#if r.ritual && s.spellcasting.ritualCasting}
								<!-- ritual cast: no spell slot (A17). Only shown when the character HAS ritual casting
								     (E7 — Wizard/Cleric/Druid/Bard; not base Warlock). Row-click casts normally. -->
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<span
									class="ritual-cast"
									role="button"
									tabindex="-1"
									title="Cast as ritual (no slot, +10 min)"
									onclick={(e) => {
										e.stopPropagation();
										cast(r, e, { ritual: true });
									}}>R</span
								>
							{/if}
						</span>
						<span class="spell-summary">{r.spe}</span>
						{#if r.res}<span class="resolution-tag {r.res}">{r.resLabel}</span>{:else}<span
							></span>{/if}
						<span class="spell-level"
							>{#if r.ct}<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions --><i
									class="cast-icon"
									title={r.ct === 'react' ? 'reaction' : 'bonus action'}
									onclick={(e) => {
										e.stopPropagation();
										toast(`Casting time: ${r.ct === 'react' ? 'reaction' : 'bonus action'}`);
									}}>{r.ct === 'react' ? '↩' : '⚡'}</i
								>{/if}{r.tm}</span
						>
					</button>
				{/each}
			</div>
		{/each}
	</div>
{/if}

<style>
	.castline {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin: -2px 0 9px;
	}
	.castline b {
		color: var(--color-resource);
		font-family: var(--font-display);
		font-weight: 700;
	}
	.castline b.castcls {
		color: var(--color-accent-bright);
	}
	.castsep {
		color: var(--color-border-strong);
	}
	.spell-rows {
		margin-top: 2px;
	}
	.spell-category {
		display: flex;
		align-items: center;
		gap: 9px;
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
		padding: 11px 0 3px;
		break-inside: avoid;
	}
	.spell-category.star {
		color: var(--color-accent-bright);
	}
	.spell-category .pips {
		display: flex;
		gap: 5px;
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
		gap: 8px;
		padding: 7px 6px;
		border-top: 1px solid var(--color-border);
		border-radius: 7px;
		cursor: pointer;
		break-inside: avoid;
		width: 100%;
		background: transparent;
		border-left: 0;
		border-right: 0;
		border-bottom: 0;
		color: var(--color-text);
		text-align: left;
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
		gap: 6px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
	.spell-row .row-name .name-main {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.spell-row .pinstar {
		flex: none;
	}
	.spell-row .spell-summary {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		font-weight: 600;
		white-space: nowrap;
		text-align: right;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.spell-row .resolution-tag {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		border-radius: 5px;
		padding: 2px 4px;
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
		text-align: right;
		white-space: nowrap;
	}
	.spell-row .spell-level .cast-icon {
		font-style: normal;
		margin-right: 6px;
		color: var(--color-accent-bright);
		cursor: help;
	}
	.prep {
		position: relative;
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		border: 1.5px solid var(--color-border-strong);
		margin-right: 8px;
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
	.pinstar {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		background: transparent;
		border: 0;
		color: var(--color-border-strong);
		margin-left: 5px;
		cursor: pointer;
		font-size: var(--font-size-xs);
		line-height: 1;
		border-radius: 50%;
	}
	/* big invisible click target so the star is easy to hit (same trick as the prep dot) */
	.pinstar::before {
		content: '';
		position: absolute;
		inset: -7px;
		border-radius: 50%;
	}
	/* hover = a FILLED disc behind the star (bg + halo of the same colour, so it's a solid circle, not
	   a donut). The glyph itself never changes colour — a pinned ★ stays gold, an unpinned ☆ stays
	   dim — only the disc appears behind it. */
	.pinstar:hover {
		background: var(--color-border);
		box-shadow: 0 0 0 2px var(--color-border);
	}
	.pinstar.on {
		color: var(--color-accent-bright);
	}
	/* B9: worn non-proficient armor blocks spellcasting (RAW rule-block) */
	.armor-block {
		margin: 4px 0 6px;
		padding: 4px 8px;
		border: 1px solid var(--color-danger);
		border-radius: 4px;
		color: var(--color-danger);
		font-size: 0.85em;
	}
	/* ritual-cast badge — only on ritual-tagged spells; casts with no slot */
	.ritual-cast {
		margin-left: 6px;
		padding: 0 5px;
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
