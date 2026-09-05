<script lang="ts">
	// The Combat stat section: AC / Initiative / Speed tiles on the top row, the passive-senses row
	// beneath them, and — when the character has any — a tall Resources block filling the right column
	// (spanning both rows). Resources are just counters, so they live here in the sheet's stat grid
	// rather than a full-width bar of their own; the chips wrap to fill the block (1 or 12, it scales).
	// Reads the `combat` view-model; the derived sheet comes in as a prop.
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import { abilityShortLabel } from '$lib/util/format';
	import { damageTypeLabel } from '$lib/combat/attacks';
	import type { CharacterSheet } from '$lib/character/derive';
	import { combat } from '../combat-view-model.svelte';
	import { why, signed, metres, range, rechargeLabel } from '$lib/combat/helpers';
	import { provenance } from '$lib/actions/provenance';
	import { sourceText, SOURCE_KEY } from '$lib/rules/pipeline';

	let { s }: { s: CharacterSheet } = $props();
	const passives = $derived(combat.passives);
	const collapsed = $derived(combat.layout.collapsed);
	const { toggle } = combat.layout;
	const { roll, openMenu } = combat;

	// Above this many pips a row is a wall of dots (and a garbage homebrew `max` could OOM the
	// render) — past the cap we show a numeric counter instead of pips (B10).
	const PIP_CAP = 20;

	// Defenses as chip groups (resist / immune / vulnerable), only the non-empty ones — rendered as
	// per-type pills instead of a bold run-on list.
	const defenseGroups = $derived(
		[
			{ bucket: 'resist', types: s.defenses.resist },
			{ bucket: 'immune', types: s.defenses.immune },
			{ bucket: 'vulnerable', types: s.defenses.vulnerable },
		].filter((g) => g.types.length),
	);
</script>

<div class="sectlab">
	<button class="slabtoggle" onclick={() => toggle('combat')}
		><span class="chevron"
			><Icon name={collapsed.combat ? 'chevron-right' : 'chevron-down'} size={13} /></span
		>{$_('combat.section.combat')}</button
	>
</div>
{#if !collapsed.combat}
	<section class="combat-grid" class:has-resources={s.resources.length}>
		<button
			class="tile"
			use:provenance={why(s.ac, $_)}
			onclick={(e) => roll({ text: 'AC (touch)', key: 'combat.roll.acTouch' }, 0, e)}
		>
			<div class="tile-key">{$_('combat.section.armorClass')}</div>
			<div class="tile-value">{s.ac.value}</div>
			<div class="tile-text">
				{s.ac.trace.map((x) => `${sourceText(x, $_)} ${signed(x.amount)}`).join(' ')}
			</div>
		</button>
		<button
			class="tile"
			use:provenance={why(s.initiative, $_)}
			onclick={(e) =>
				roll(
					{ text: 'Initiative', key: 'combat.roll.initiative' },
					s.initiative.value,
					e,
					'initiative',
				)}
		>
			<div class="tile-key">{$_('combat.roll.initiative')}</div>
			<div class="tile-value">{signed(s.initiative.value)}</div>
			<div class="tile-text">
				{abilityShortLabel('dex', $_)} <b>{signed(s.abilities.dex.mod)}</b>
			</div>
		</button>
		<div class="tile" use:provenance={why(s.speed, $_)}>
			<div class="tile-key">{$_('combat.section.speed')}</div>
			<!-- the space goes OUTSIDE <small>: Svelte trims whitespace at an element's edges, so a leading
			     one inside it is dropped and the metric hugs the "ft" -->
			<div class="tile-value">{s.speed.value} ft <small>({metres(s.speed.value)})</small></div>
			<div class="tile-text">{$_('combat.section.baseWalk')}</div>
		</div>

		{#if s.resources.length}
			<!-- tall Resources block (right column, spans both rows); chips wrap by size to fill it -->
			<div class="resources-block">
				<span class="bar-label eyebrow">{$_('combat.section.resources')}</span>
				<div class="resource-chips">
					{#each s.resources as r (r.id)}
						{@const spent = combat.resources.resourceSpent(r.id)}
						<!-- the whole chip is the "use one" action (UBUG-8): when the pool has exactly ONE
						     action-option it RUNS it (Second Wind heals, Rage enters the state — cost + turn
						     slot included, UBUG-16); with several or none it decrements the pool. The pips
						     inside still set the count manually and stop the chip's use-click -->
						<button
							type="button"
							class="resource"
							title="Use one {r.name} · {rechargeLabel(r.recharge)} ({r.source})"
							onclick={() => combat.useResourceOrEnter(r.id, r.max)}
						>
							{r.name}
							{#if Number.isFinite(r.max) && r.max <= PIP_CAP}
								<span class="resource-pips">
									{#each range(r.max) as i (i)}
										<!-- svelte-ignore a11y_click_events_have_key_events -->
										<span
											class="resource-pip"
											class:used={i >= r.max - spent}
											role="button"
											tabindex="-1"
											aria-label="{r.name} {i + 1}"
											onclick={(e) => {
												e.stopPropagation();
												combat.resources.resourceClick(r.id, r.max, i);
											}}
										></span>
									{/each}
								</span>
								<small>{r.max - spent}/{r.max}</small>
							{:else if Number.isFinite(r.max)}
								<!-- too many to draw as pips (B10): numeric counter only -->
								<small>{r.max - spent}/{r.max}</small>
							{:else}
								<!-- an unlimited pool (`inf` max — 5e Rage at 20): count uses since recharge -->
								<small>{spent} · ∞</small>
							{/if}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<div class="senses-strip">
			<span class="bar-label eyebrow">{$_('combat.section.passiveSenses')}</span>
			{#each passives as p, i (p.key)}
				{#if i > 0}<span class="separator-dot">·</span>{/if}
				<!-- matched on the contribution's KEY, not on the English word it reads as -->
				{@const advDis = p.comp.trace.find(
					(t) => t.key === SOURCE_KEY.advantage || t.key === SOURCE_KEY.disadvantage,
				)}
				{@const isAdv = advDis?.key === SOURCE_KEY.advantage}
				<span class="ability-save" use:provenance={why(p.comp, $_)}>
					<i>{$_(`skillName.${p.key}`)}</i>{p.comp.value}{#if advDis}<span
							class="advantage-mark"
							class:disadvantage={!isAdv}
							title={sourceText(advDis, $_)}
							><Icon name={isAdv ? 'chevron-up' : 'chevron-down'} size={12} /></span
						>{/if}
				</span>
			{:else}
				<span class="ability-save"><i>{$_('combat.section.nonePinned')}</i></span>
			{/each}
			<button class="edit" onclick={(e) => openMenu('pinskills', e)}
				><Icon name="pencil" size={13} /> {$_('combat.section.pinSkills')}</button
			>
		</div>

		{#if defenseGroups.length}
			<div class="senses-strip defenses-strip">
				<span class="bar-label eyebrow">{$_('combat.section.defenses')}</span>
				{#each defenseGroups as g (g.bucket)}
					<span class="def-group">
						<span class="def-label">{$_(`combat.defense.${g.bucket}`)}</span>
						{#each g.types as t (t)}<span class="def-chip def-chip--{g.bucket}"
								>{damageTypeLabel(t, $_)}</span
							>{/each}
					</span>
				{/each}
			</div>
		{/if}
	</section>
{/if}

<style>
	.combat-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-3);
		margin-bottom: 22px;
		align-items: stretch;
	}
	/* passive-senses + defenses rows span the full stat width */
	.combat-grid .senses-strip {
		grid-column: 1 / -1;
	}
	/* with resources: a 4th column holds the tall Resources block (both rows); the senses row then
	   spans only the three stat columns, leaving the block beside it */
	.combat-grid.has-resources {
		grid-template-columns: repeat(3, 1fr) minmax(150px, 0.85fr);
	}
	.combat-grid.has-resources .resources-block {
		grid-column: 4;
		grid-row: 1 / 3;
	}
	.combat-grid.has-resources .senses-strip {
		grid-column: 1 / 4;
	}
	.combat-grid.has-resources .defenses-strip {
		grid-column: 1 / -1;
	}

	.tile {
		/* a <button> centres its content vertically whatever its display is, so the tiles with less text
		   than their neighbours (Initiative, one line) floated 8px below the ones with more (AC, two).
		   An explicit flex column replaces the UA's centring with our own alignment, and the plain-div
		   tile lays out the same way, so the row reads off one top edge. */
		display: flex;
		flex-direction: column;
		align-items: stretch;
		justify-content: flex-start;
		text-align: start;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: 13px;
		padding: var(--space-3) 15px;
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
		font-size: var(--font-size-micro);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-accent-bright);
	}
	.tile .tile-value {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-h3);
		line-height: 1.05;
		margin-top: var(--space-1);
	}
	.tile .tile-value small {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		font-weight: 500;
	}
	.tile .tile-text {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin-top: var(--space-1-5);
	}
	.tile .tile-text b {
		color: var(--color-resource);
	}

	/* the tall Resources block: label on top, chips wrapping below to fill the column */
	.resources-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 13px;
		padding: var(--space-3) 14px;
	}
	.resource-chips {
		display: flex;
		flex-wrap: wrap;
		align-content: flex-start;
		gap: var(--space-1-5);
	}
	/* the whole chip is the "use one" button (UBUG-8) — clickable + highlighted on hover */
	.resource-chips .resource {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1-5);
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-xs);
		color: var(--color-text);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		padding: var(--space-1) var(--space-2-5);
		cursor: pointer;
	}
	.resource-chips .resource small {
		font-family: var(--font-mono);
		color: var(--color-text-muted);
	}
	.resource-chips .resource:hover {
		background: var(--color-border);
	}
	.resource-pips {
		display: inline-flex;
		gap: var(--space-1);
	}
	.resource-pip {
		display: inline-block;
		width: 12px;
		height: 12px;
		padding: 0;
		border: 1px solid var(--color-resource);
		border-radius: 50%;
		background: var(--color-resource);
		cursor: pointer;
	}
	.resource-pip.used {
		background: transparent;
		border-color: var(--color-border-strong);
	}

	.senses-strip {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 14px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: var(--space-2-5) var(--space-4);
	}
	/* mono/uppercase/tracking/muted come from the shared .eyebrow primitive; keep only the micro size */
	.senses-strip .bar-label {
		font-size: var(--font-size-micro);
	}
	.senses-strip .ability-save {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-md);
	}
	.senses-strip .ability-save i {
		font-style: normal;
		font-family: var(--font-body);
		font-weight: 400;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin-inline-end: var(--space-1-5);
	}
	.senses-strip .separator-dot {
		color: var(--color-border-strong);
	}
	/* a passive is ±5 under advantage/disadvantage (RAW) — mark it so a low number reads as
	   "reduced by a debuff", not a bug. The chevron is green up for advantage, red down for disadvantage. */
	.senses-strip .advantage-mark {
		font-size: var(--font-size-xs);
		margin-inline-start: var(--space-1);
		/* muted toward the surface so the arrow recedes (darker on dark, lighter on light) — a hint,
		   not an attention-grabber; the direction still reads adv/dis, tooltip has the detail */
		color: color-mix(in srgb, var(--color-good) 45%, var(--color-surface));
	}
	.senses-strip .advantage-mark.disadvantage {
		color: color-mix(in srgb, var(--color-danger) 45%, var(--color-surface));
	}
	.senses-strip .edit {
		margin-inline-start: auto;
		font-family: var(--font-body);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		cursor: pointer;
		align-self: center;
	}
	.senses-strip .edit:hover {
		color: var(--color-text);
		border-color: var(--color-border-strong);
		background: var(--color-surface-2);
	}
	/* Defenses: per-type PILLS, not a bold run-on list. One group per bucket (a muted label + its
	   chips); the chip colour encodes protection — resist (teal outline) → immune (teal filled) →
	   vulnerable (danger). Regular weight, semantic tokens only (theme-safe). */
	.defenses-strip .def-group {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1-5);
	}
	.defenses-strip .def-label {
		font-family: var(--font-body);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.defenses-strip .def-chip {
		font-family: var(--font-body);
		font-weight: 400;
		font-size: var(--font-size-xs);
		line-height: 1.6;
		padding: 1px var(--space-2);
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border-strong);
		color: var(--color-text);
		text-transform: capitalize;
	}
	.defenses-strip .def-chip--resist {
		border-color: var(--color-good-line);
		color: var(--color-good);
	}
	.defenses-strip .def-chip--immune {
		border-color: var(--color-good-line);
		background: var(--color-good-soft);
		color: var(--color-good);
	}
	.defenses-strip .def-chip--vulnerable {
		border-color: color-mix(in srgb, var(--color-danger) 45%, var(--color-surface));
		color: var(--color-danger);
	}
</style>
