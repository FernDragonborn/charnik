<script lang="ts">
	// The Combat stat section: AC / Initiative / Speed tiles on the top row, the passive-senses row
	// beneath them, and — when the character has any — a tall Resources block filling the right column
	// (spanning both rows). Resources are just counters, so they live here in the sheet's stat grid
	// rather than a full-width bar of their own; the chips wrap to fill the block (1 or 12, it scales).
	// Reads the `combat` view-model; the derived sheet comes in as a prop.
	import type { CharacterSheet } from '$lib/character/derive';
	import { combat } from '../state.svelte';
	import { why, signed, metres, range, rechargeLabel } from '$lib/combat/helpers';

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
			{ bucket: 'resist', label: 'Resist', types: s.defenses.resist },
			{ bucket: 'immune', label: 'Immune', types: s.defenses.immune },
			{ bucket: 'vulnerable', label: 'Vulnerable', types: s.defenses.vulnerable }
		].filter((g) => g.types.length)
	);
</script>

<div class="sectlab">
	<button class="slabtoggle" onclick={() => toggle('combat')}
		><span class="chevron">{collapsed.combat ? '▸' : '▾'}</span>Combat</button
	>
</div>
{#if !collapsed.combat}
	<section class="combat-grid" class:has-resources={s.resources.length}>
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

		{#if s.resources.length}
			<!-- tall Resources block (right column, spans both rows); chips wrap by size to fill it -->
			<div class="resources-block">
				<span class="bar-label eyebrow">Resources</span>
				<div class="resource-chips">
					{#each s.resources as r (r.id)}
						{@const spent = combat.resources.resourceSpent(r.id)}
						<!-- the whole chip is the "use one" action (UBUG-8): for a resource with an
						     activated-buff option (Rage) it ENTERS that state, else it decrements the pool;
						     the pips inside still set the count manually and stop the chip's use-click -->
						<button
							type="button"
							class="resource"
							title="Use one {r.name} · {rechargeLabel(r.recharge)} ({r.source})"
							onclick={() => combat.useResourceOrEnter(r.id, r.max)}
						>
							{r.name}
							{#if Number.isFinite(r.max) && r.max <= PIP_CAP}
								<span class="respips">
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
			<span class="bar-label eyebrow">Passive senses</span>
			{#each passives as p, i (p.key)}
				{#if i > 0}<span class="separator-dot">·</span>{/if}
				{@const advDis = p.comp.trace.find(
					(t) => t.source === 'Advantage' || t.source === 'Disadvantage'
				)}
				<span class="ability-save" title={why(p.comp)}>
					<i>{p.name}</i>{p.comp.value}{#if advDis}<span
							class="advdis"
							class:dis={advDis.source === 'Disadvantage'}
							title={advDis.source}>{advDis.source === 'Advantage' ? '▲' : '▼'}</span
						>{/if}
				</span>
			{:else}
				<span class="ability-save"><i>none pinned</i></span>
			{/each}
			<button class="edit" onclick={(e) => openMenu('pinskills', e)}>✎ Pin skills</button>
		</div>

		{#if defenseGroups.length}
			<div class="senses-strip defenses-strip">
				<span class="bar-label eyebrow">Defenses</span>
				{#each defenseGroups as g (g.bucket)}
					<span class="def-group">
						<span class="def-label">{g.label}</span>
						{#each g.types as t (t)}<span class="def-chip def-chip--{g.bucket}">{t}</span>{/each}
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
		gap: 12px;
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
		margin-top: 4px;
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
		margin-top: 6px;
	}
	.tile .tile-text b {
		color: var(--color-resource);
	}

	/* the tall Resources block: label on top, chips wrapping below to fill the column */
	.resources-block {
		display: flex;
		flex-direction: column;
		gap: 9px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 13px;
		padding: 12px 14px;
	}
	.resource-chips {
		display: flex;
		flex-wrap: wrap;
		align-content: flex-start;
		gap: 7px;
	}
	/* the whole chip is the "use one" button (UBUG-8) — clickable + highlighted on hover */
	.resource-chips .resource {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-xs);
		color: var(--color-text);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		padding: 5px 11px;
		cursor: pointer;
	}
	.resource-chips .resource small {
		font-family: var(--font-mono);
		color: var(--color-text-muted);
	}
	.resource-chips .resource:hover {
		background: var(--color-border);
	}
	.respips {
		display: inline-flex;
		gap: 4px;
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
		padding: 11px 16px;
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
		margin-right: 6px;
	}
	.senses-strip .separator-dot {
		color: var(--color-border-strong);
	}
	/* a passive is ±5 under advantage/disadvantage (RAW) — mark it so a low number reads as
	   "reduced by a debuff", not a bug. ▲ green = advantage, ▼ red = disadvantage. */
	.senses-strip .advdis {
		font-size: var(--font-size-xs);
		margin-left: 3px;
		/* muted toward the surface so the arrow recedes (darker on dark, lighter on light) — a hint,
		   not an attention-grabber; the direction still reads adv/dis, tooltip has the detail */
		color: color-mix(in srgb, var(--color-good) 45%, var(--color-surface));
	}
	.senses-strip .advdis.dis {
		color: color-mix(in srgb, var(--color-danger) 45%, var(--color-surface));
	}
	.senses-strip .edit {
		margin-left: auto;
		font-family: var(--font-body);
		font-size: var(--font-size-xs);
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
	/* Defenses: per-type PILLS, not a bold run-on list. One group per bucket (a muted label + its
	   chips); the chip colour encodes protection — resist (teal outline) → immune (teal filled) →
	   vulnerable (danger). Regular weight, semantic tokens only (theme-safe). */
	.defenses-strip .def-group {
		display: inline-flex;
		align-items: center;
		gap: 6px;
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
		padding: 1px 8px;
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
