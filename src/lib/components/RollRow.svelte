<script lang="ts">
	// The rendering of ONE roll — the label, the grid (a line per attack), and the provenance note.
	// This is the whole of what a roll looks like, and it is deliberately the SAME component
	// everywhere a roll is shown: the toast, the Playbar's last-roll chip, the roll log, the dice
	// tray. Those four used to print the roller's internal `expr` in four different shapes, so one
	// roll read four ways and the log — the surface you go to precisely to re-read a roll — was the
	// worst of them (UBUG-20).
	//
	// Everything a surface does AROUND the roll is chrome and stays outside: the toast's dismiss
	// button and follow-up action bar, the log's per-row affordances, the Playbar's log cue. There is
	// no `variant`/`compact` prop — a difference that needs one belongs in the chrome, not here.
	// Density is decided from the model itself (a volley drops its per-type chips, see `multi`).
	import Icon from './Icon.svelte';
	import {
		ROLL_LAYOUT,
		type RollLayout,
		type RollToastModel,
		type RollToastAttack,
		type RollToastDamage,
	} from '$lib/dice/roll-toast';
	import {
		ADVANTAGE_CUE,
		ADVANTAGE_MODE,
		type AdvantageMode,
		type FlatPart,
		type RolledDie,
	} from '$lib/rules/dice';
	import DamageIcon from './DamageIcon.svelte';
	import { signed } from '$lib/util/format';
	import { _ } from '$lib/i18n';
	import { damageTypeLabel } from '$lib/combat/attacks';
	import { AUTO_OUTCOME, rollNameOf, sayRollName } from '$lib/combat/roll';

	let {
		model,
		onAdvantage,
		rerollDamage,
		layout = ROLL_LAYOUT.card,
	}: {
		model: RollToastModel;
		/** Present → the d20 pill becomes a control that applies advantage AFTER the fact (UX-3): tap
		 *  it and a second d20 joins the first. Absent → every pill is inert, which is how the toast
		 *  mounts it (a toast expires mid-decision, so it announces and the Playbar/log control). No
		 *  attack index: a volley rolls the same set N times, which is what the two-level model decided
		 *  a volley IS, so a per-instance advantage is not a thing there is to choose. */
		onAdvantage?: (() => void) | undefined;
		/** The ONE damage pill that can be rerolled right now, and what taking it does. Names the pill
		 *  by position because that is the RAW unit — "reroll the weapon's damage dice" is one damage
		 *  part is one pill — rather than a bar under a row that can't say which row it means. */
		rerollDamage?: { attack: number; part: number; label: string; run: () => void } | undefined;
		/** Card (every die, captions, a row per attack) or strip (one line, bounded content). See
		 *  ROLL_LAYOUT — the strip is not a smaller card, it answers a different question, so the two
		 *  differ in what they show and not only in how it is arranged. */
		layout?: RollLayout;
	} = $props();

	/** The one place the layout is compared; everything below reads this. */
	const strip = $derived(layout === ROLL_LAYOUT.strip);

	/** What the row is called: the catalog key when the roll has one, its English otherwise. A roll a
	 *  condition decided instead of the die says so around that name — the outcome is a fact on the
	 *  record, so the phrase is the translator's to arrange rather than one baked into the label. */
	const rollLabel = $derived.by(() => {
		const named = sayRollName(rollNameOf(model), $_);
		return model.outcome
			? $_(
					model.outcome === AUTO_OUTCOME.fail ? 'combat.roll.autoFail' : 'combat.roll.autoSucceed',
					{ values: { label: named } },
				)
			: named;
	});

	/** A marker — a rest, a no-roll cast, a save a condition decided — threw nothing, so its total is
	 *  `NaN` on the record and the number column stays empty rather than printing that. */
	const shown = (n: number) => (Number.isFinite(n) ? n : '');

	const attacks = $derived(model.attacks);
	const multi = $derived(attacks.length > 1 && model.damaging);
	/** Both halves are present → the to-hit columns and the captions that name them. */
	const twoPart = $derived(model.damaging && model.tested);
	// a die that came up max reads as gold, a 1 as spent — the d20 says it loudest (it decides things)
	const tone = (c: RolledDie) =>
		c.value === c.sides ? 'max' : c.value === 1 ? 'min' : ('' as const);
	const face = (c: RolledDie) => `${c.sign < 0 ? '−' : ''}${c.value}`;

	/** Which chip of an attack is THE d20 that decided it — the first positive one, matching what
	 *  `amendWithAdvantage` picks. -1 when the roll has no d20 to amend. */
	const d20Index = (a: RollToastAttack) => a.chips.findIndex((c) => c.sides === 20 && c.sign > 0);
	/** Any roll with a d20 can be told how it was rolled — including one a pair already decided, which
	 *  is the toggle: tapping again switches advantage and disadvantage. */
	const canAmend = (a: RollToastAttack) => !!onAdvantage && d20Index(a) >= 0;
	/** The cue says what the roll IS, not what a tap would make it: a triangle pointing the way the
	 *  advantage goes, or a diamond when neither applies. In the neutral state the diamond is also the
	 *  only thing marking the pill as a control, since there is no frame yet. Drawn in CSS rather than
	 *  set as a character — at cue size a font glyph has no stem to snap to and the rasteriser turns
	 *  its diagonals to mush (`◆` came out a blob, `⇈` drew its two arrows at different heights). */
	const cueShape = (a: RollToastAttack) => ADVANTAGE_CUE[a.advantageMode ?? ADVANTAGE_MODE.neither];
	const CUE_TITLE: Record<AdvantageMode, string> = {
		[ADVANTAGE_MODE.advantage]: 'roller.cue.advantage',
		[ADVANTAGE_MODE.disadvantage]: 'roller.cue.disadvantage',
		[ADVANTAGE_MODE.neither]: 'roller.cue.neither',
	};
	/** The pill states its own advantage; only a d20 roll can be told a different one. */
	const HIT_TITLE: Record<AdvantageMode, string | undefined> = {
		[ADVANTAGE_MODE.advantage]: 'roller.hit.advantage',
		[ADVANTAGE_MODE.disadvantage]: 'roller.hit.disadvantage',
		[ADVANTAGE_MODE.neither]: undefined,
	};
	const cueTitle = (a: RollToastAttack) => $_(CUE_TITLE[a.advantageMode ?? ADVANTAGE_MODE.neither]);

	/**
	 * One line can hold a bounded number of pills, and a pool is NOT bounded — a Fireball is 8d6, a
	 * Meteor Swarm 40. So the strip keeps the dice that are load-bearing and folds the rest into a
	 * count: the d20 stays because it decides the roll AND is the advantage control, everything else
	 * becomes `8d6`, which is what a player would say out loud anyway. The card keeps every die, and
	 * the log is one tap away — the die-by-die breakdown is audit information, the same reasoning the
	 * design already applies to a volley's rows.
	 */
	/** A die's hover story: what it showed, and which effect gave it when the roll recorded one.
	 *  `source` is the provenance the fold now carries through — a Bless d4 reads as a Bless d4. */
	const dieTitle = (c: RolledDie): string =>
		`d${c.sides} · ${c.detail}${c.source ? ` · ${c.source}` : ''}`;

	/** A flat modifier's hover: what it was made of, when the roll recorded it. Without parts there is
	 *  nothing to say the number does not already say, so there is no tooltip at all. */
	const modTitle = (parts: FlatPart[] | undefined): string | undefined =>
		parts?.map((p) => `${signed(p.amount)}${p.source ? ` ${p.source}` : ''}`).join(' · ');

	const shownChips = (a: RollToastAttack) =>
		strip ? a.chips.filter((c) => c.sides === 20) : a.chips;
	const foldedDice = (a: RollToastAttack): string => {
		if (!strip) return '';
		const counts = new Map<number, number>();
		for (const c of a.chips)
			if (c.sides !== 20) counts.set(c.sides, (counts.get(c.sides) ?? 0) + 1);
		return [...counts]
			.sort((x, y) => y[0] - x[0])
			.map(([sides, n]) => `${n}d${sides}`)
			.join(' + ');
	};
</script>

{#snippet hitDice(a: RollToastAttack)}
	{@const hitKey = HIT_TITLE[a.advantageMode ?? ADVANTAGE_MODE.neither]}
	<span class="roll-to-hit" title={hitKey ? $_(hitKey) : undefined}>
		{#each shownChips(a) as c, i (i)}
			{#if c.sides === 20 && i === 0 && canAmend(a)}
				<button
					type="button"
					class="roll-die d20 tappable {tone(c)}"
					title={cueTitle(a)}
					onclick={() => onAdvantage?.()}
					>{face(c)}<span class="roll-cue advantage-cue advantage-cue-{cueShape(a)}"></span></button
				>
			{:else}
				<span class="roll-die {tone(c)}" class:d20={c.sides === 20} title={dieTitle(c)}
					>{face(c)}{#if c.sides === 20 && i === 0 && a.advantageMode}<span
							class="roll-cue advantage-cue advantage-cue-{cueShape(a)}"
						></span>{/if}</span
				>
			{/if}
		{/each}
		{#if a.dropped !== undefined}
			<span class="roll-die dropped-die" title={$_('roller.droppedD20')}>{a.dropped}</span>
		{/if}
		{#if foldedDice(a)}
			<span class="roll-die folded-dice" title={a.chips.map((c) => c.detail).join(' + ')}
				>{foldedDice(a)}</span
			>
		{/if}
		{#if a.mod}<span class="roll-modifier" title={modTitle(a.modParts)}>{signed(a.mod)}</span>{/if}
	</span>
{/snippet}

<!-- one damage type: glyph, then its dice in a SINGLE pill (a crit's doubled dice share it, divided),
     then the flat mod. A dice-less part (a fixed "1 bludgeoning") puts its value in the pill. -->
{#snippet damagePart(d: RollToastDamage, attack: number, part: number)}
	{@const re =
		rerollDamage && rerollDamage.attack === attack && rerollDamage.part === part
			? rerollDamage
			: undefined}
	<span class="roll-damage-part" title={damageTypeLabel(d.type, $_) || undefined}>
		<DamageIcon type={d.type} />
		<svelte:element
			this={re ? 'button' : 'span'}
			role={re ? 'button' : undefined}
			type={re ? 'button' : undefined}
			class="roll-die"
			class:tappable={re}
			title={re
				? re.label
				: `${d.chips.map((c) => c.detail).join(' + ')}${d.mod ? ` ${signed(d.mod)}` : ''}`}
			onclick={re ? () => re.run() : undefined}
		>
			{#if strip}
				<!-- one line has no room for a die-by-die breakdown, and that breakdown is audit
				     information: the same rule the design already applies to a volley's rows. The part's
				     TOTAL is what a player reads here; the log, one tap away, renders every die. -->
				<span>{d.total}</span>
			{:else if d.chips.length}
				{#each d.chips as c, i (i)}
					{#if i}<span class="roll-die-divider"></span>{/if}
					<span title={dieTitle(c)}>{face(c)}</span>
				{/each}
			{:else}
				<span>{d.total}</span>
			{/if}
			{#if re}<span class="roll-cue"><Icon name="rotate-ccw" size={9} /></span>{/if}
		</svelte:element>
		{#if d.mod && d.chips.length && !strip}<span class="roll-modifier" title={modTitle(d.modParts)}
				>{signed(d.mod)}</span
			>{/if}
	</span>
{/snippet}

<div class="roll-row" class:strip title={strip && model.note ? model.note : undefined}>
	<!-- the key when the roll has one, so a roll made under one language still reads in the language
	     the log is being READ in; `label` is the English fallback every custom roll has -->
	<span class="roll-label">{rollLabel}</span>
	{#if strip && multi}
		<!-- a volley cannot flow inline: three attacks each with their own dice and damage types is a
		     two-dimensional thing, and forcing it onto one line is exactly the overlap this layout
		     exists to avoid. A strip says WHAT happened and how much; the card and the log carry the
		     attack-by-attack breakdown. -->
		<span class="roll-grid volley">
			<span class="roll-modifier"
				>{$_('roller.attacks', { values: { count: attacks.length } })}</span
			>
			{#each model.byType as t, i (i)}
				<span class="roll-type-sum" title={damageTypeLabel(t.type, $_) || undefined}>
					<DamageIcon type={t.type} size={14} /><span>{t.total}</span>
				</span>
			{/each}
			<span class="roll-total big-total">{shown(model.total)}</span>
		</span>
	{:else}
		<span
			class="roll-grid"
			class:damaging={twoPart}
			class:damage-only={model.damaging && !model.tested}
			class:multi
		>
			<!-- the captions name the two NUMBERS, not the dice: "to hit" spans the dice columns so its
		     own width can't widen them, and lands on the to-hit total's right edge. A damage-only roll
		     has nothing to distinguish, so it gets no captions at all. -->
			{#if twoPart}
				<span class="roll-caption hit eyebrow">{$_('roller.toHit')}</span>
				<span></span>
				<span class="roll-caption eyebrow">{$_('roller.damage')}</span>
			{/if}
			{#each attacks as a, i (i)}
				{#if multi}<span class="roll-attack-index" class:nat-20={a.natural === 20}>{i + 1}</span
					>{/if}
				{#if model.tested}{@render hitDice(a)}{/if}
				{#if twoPart}
					<span
						class="roll-to-hit-total"
						class:nat-20={a.natural === 20}
						class:nat-1={a.natural === 1}>{a.subtotal}</span
					>
				{/if}
				{#if model.damaging}
					<span class="roll-damage">
						{#if a.natural === 1}
							<span class="roll-no-damage">—</span>
						{:else}
							{#each a.damage as d, j (j)}{@render damagePart(d, i, j)}{/each}
						{/if}
					</span>
				{/if}
				<span
					class="roll-total"
					class:big-total={!multi}
					class:nat-20={a.natural === 20}
					class:nat-1={a.natural === 1}
				>
					{#if !model.damaging}{shown(a.subtotal)}{:else if a.natural === 1}<span class="roll-miss"
							>{$_('roller.miss')}</span
						>{:else}{a.damageTotal}{/if}
				</span>
			{/each}
			{#if multi}
				<span class="roll-type-sums">
					{#each model.byType as t, i (i)}
						<span class="roll-type-sum" title={damageTypeLabel(t.type, $_) || undefined}>
							<DamageIcon type={t.type} size={14} /><span>{t.total}</span>
						</span>
					{/each}
				</span>
				<span class="roll-total big-total grand-total">{shown(model.total)}</span>
			{/if}
		</span>
	{/if}
	<!-- the note is a RECORD (an upcast's provenance, an amendment) and records belong in the log,
	     which is one tap away and renders it in full. On a one-line strip it is permanent space for a
	     few seconds of value, and for an amendment it is redundant besides: the cue in the d20 and the
	     struck-through die already say the roll was changed. Kept as the strip's tooltip. -->
	{#if model.note && !strip}<span class="roll-note"
			><Icon name="arrow-up" size={11} /> {model.note}</span
		>{/if}
</div>

<style>
	/* the roll owns its own stacking now — a mounting surface just gives it a box, it doesn't have to
	   know that a roll is three sibling spans */
	.roll-row {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	/* one line: the label sits beside the numbers, the column captions fold away (they title columns
	   that no longer exist as a grid), and the totals stop being display-sized */
	.roll-row.strip {
		flex-direction: row;
		align-items: center;
	}
	/* the label yields FIRST when the strip runs out of room: you just rolled it, and the log keeps it
	   in full. Everything to its right is either a control or a number, and neither can be ellipsised. */
	.strip .roll-label {
		flex: 0 1 auto;
		min-width: 3ch;
		padding: var(--space-2) var(--space-1) var(--space-2) var(--space-3);
	}
	.strip .roll-grid,
	.strip .roll-grid.damaging,
	.strip .roll-grid.multi,
	.strip .roll-grid.volley {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 0 var(--space-1);
	}
	.strip .roll-caption {
		display: none;
	}
	.strip .roll-to-hit,
	.strip .roll-damage {
		padding: 0;
		border-inline-start: 0;
	}
	.strip .roll-to-hit-total {
		padding-inline-end: 0;
	}
	.strip .roll-total,
	.strip .roll-total.big-total {
		padding: 0 var(--space-2-5);
		font-size: var(--font-size-body);
		border-inline-start: 1px solid var(--color-border);
	}

	.roll-label {
		padding: var(--space-2-5) var(--space-4) var(--space-2);
		font-family: var(--font-display);
		font-size: var(--font-size-body);
		font-weight: 600;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* one row per attack. The fixed-ish columns let a stack of rolls read down the same seams; they
	   grow past their floor rather than clip (a dropped adv die, a three-digit total). */
	.roll-grid {
		display: grid;
		grid-template-columns: 1fr 58px;
		align-items: center;
		padding: 0 0 var(--space-1-5) var(--space-4);
	}
	.roll-grid.damaging {
		grid-template-columns: minmax(58px, max-content) minmax(36px, max-content) 1fr 58px;
	}
	.roll-grid.multi {
		grid-template-columns: 26px minmax(58px, max-content) minmax(36px, max-content) 1fr 58px;
		padding-inline-start: 0;
	}
	/* damage with no test (Fireball): the damage IS the row, so it leads instead of sitting in a
	   column ruled off from a to-hit that doesn't exist */
	.roll-grid.damage-only {
		grid-template-columns: 1fr 58px;
	}
	.roll-grid.multi.damage-only {
		grid-template-columns: 26px 1fr 58px;
	}
	.damage-only .roll-damage {
		justify-content: flex-start;
		padding-inline-start: 0;
		border-inline-start: 0;
	}
	.roll-caption {
		padding: 0 0 var(--space-1);
		font-size: var(--font-size-micro);
		text-align: center;
	}
	.roll-caption.hit {
		grid-column: 1 / 3;
		padding-inline-end: var(
			--space-3
		); /* the to-hit total's own padding — the caption sits on its end edge */
		text-align: end;
	}
	.multi .roll-caption.hit {
		grid-column: 1 / 4;
	}
	/* which attack of the volley this is — a bare ordinal, gold when that one crit */
	.roll-attack-index {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-1-5) 0;
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}
	.roll-to-hit {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1-5) 0;
		/* the dice group is as wide as its dice, never as wide as its column — a grid item stretches by
		   default, and on a roll with no damage that column is `1fr`. */
		justify-self: start;
	}
	.roll-die {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		min-width: 23px;
		height: 22px;
		padding: 0 var(--space-1-5);
		border-radius: var(--radius-sm);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border-strong);
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
	}
	/* several dice of one damage type share a pill — a crit's doubled d8s are one thing, not two */
	.roll-die-divider {
		width: 1px;
		height: 12px;
		background: var(--color-border-strong);
	}
	.roll-die.max {
		background: var(--color-resource-soft);
		border-color: var(--color-resource-line);
		color: var(--color-resource);
	}
	.roll-die.min {
		color: var(--color-text-muted);
	}
	/* the d20 decides things — its extremes get the full-strength edge, not just tinted text */
	.roll-die.d20.max {
		border-color: var(--color-resource);
		font-weight: 700;
	}
	.roll-die.d20.min {
		background: var(--color-danger-soft);
		border-color: var(--color-danger);
		color: var(--color-danger);
		font-weight: 700;
	}
	/* the adv/disadv die that lost: smaller, struck through, no fill */
	.roll-die.dropped-die {
		min-width: 19px;
		height: 18px;
		padding: 0 var(--space-1);
		background: transparent;
		color: var(--color-text-muted);
		text-decoration: line-through;
	}
	/* An interactive pill must LOOK like one (docs/internals/ui.md ▸ Every interactive element says so): its own edge, a
	   cursor, a hover, a focus ring and a glyph saying what tapping does. The edge is DASHED rather
	   than coloured, and the hover is COLOURLESS, because green and red are spoken for — they say how
	   the d20 was rolled — and the theme's crimson accent sits a shade away from the red that means
	   disadvantage, so an accent hover read as "this is about to become disadvantage". A hover says
	   only that the thing is live; what the tap does is the pill's title, which is where the next state
	   belongs — it survives touch, where there is no hover at all. Inert pills are untouched, so there
	   is never a false affordance. */
	.roll-die.tappable {
		border-style: dashed;
		border-color: var(--color-border-strong);
		cursor: pointer;
	}
	/* a pill carrying the adv/disadv cue tightens around it — the cue is a marker on the die, not a
	   second value beside it */
	.roll-die:has(.roll-cue) {
		gap: 2px;
		padding-inline-end: var(--space-1);
	}
	/* The SHAPES are the shared `.advantage-cue` (styles/components.css); only the colours are ours.
	   No third colour: each shape wears the colour of the state it reports — the same teal and red the
	   toast puts on its card edge. The neutral diamond stays UNCOLOURED here, which is why it can be
	   the affordance marker without claiming a state; the roller's toggle, which has no such job,
	   colours all three. */
	.roll-cue.advantage-cue-up {
		color: var(--color-good);
	}
	.roll-cue.advantage-cue-down {
		color: var(--color-danger);
	}
	.roll-cue.advantage-cue-neither {
		color: var(--color-text-muted);
	}
	.roll-die.tappable:hover {
		border-color: var(--color-text-muted);
		background: color-mix(in srgb, var(--color-text) 10%, var(--color-surface-2));
	}
	.roll-die.tappable:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
	}
	.roll-cue {
		font-size: var(--font-size-micro);
		line-height: 1;
		opacity: 0.8;
	}
	/* the folded pool ("8d6") is a count, not a result — it reads as a caption, not as a die face */
	.roll-die.folded-dice {
		background: transparent;
		border-style: dashed;
		color: var(--color-text-muted);
		font-weight: 500;
	}
	.roll-modifier {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	/* what the to-hit came to — subordinate to the damage, which is the number being read */
	.roll-to-hit-total {
		padding-inline-end: var(--space-3);
		text-align: end;
		font-family: var(--font-display);
		font-size: var(--font-size-body);
		font-weight: 600;
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
	}
	/* the damage half of the row: glyph-led chips, right-aligned against the total's rule, wrapping
	   onto a second line when a crit doubles the types */
	.roll-damage {
		align-self: stretch;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-1);
		padding: var(--space-1-5) var(--space-3) var(--space-1-5) 14px;
		border-inline-start: 1px solid var(--color-border);
	}
	.roll-damage-part {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		flex: none;
		white-space: nowrap;
	}
	.roll-no-damage {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	/* the summary column: same width whatever the height, so a stack lines its numbers up */
	.roll-total {
		align-self: stretch;
		display: flex;
		align-items: center;
		justify-content: center;
		border-inline-start: 1px solid var(--color-border);
		font-family: var(--font-display);
		font-size: var(--font-size-body);
		font-weight: 600;
		line-height: 1;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}
	.roll-total.big-total {
		padding-bottom: var(--space-1-5);
		font-size: var(--font-size-h2);
		font-weight: 700;
		color: var(--color-text);
	}
	.roll-total.nat-20,
	.roll-to-hit-total.nat-20,
	.roll-attack-index.nat-20 {
		color: var(--color-resource);
	}
	.roll-total.nat-1,
	.roll-to-hit-total.nat-1 {
		color: var(--color-danger);
	}
	.roll-miss {
		font-size: var(--font-size-sm);
		font-weight: 600;
	}
	/* the volley's footer: what it dealt per type, then the one number that leaves the card */
	.roll-type-sums {
		/* every column but the total's, whichever shape the grid is in */
		grid-column: 1 / -2;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-3);
		padding: var(--space-1-5) var(--space-3) var(--space-2-5) 0;
	}
	.roll-type-sum {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.roll-type-sum span {
		color: var(--color-text);
	}
	.roll-total.grand-total {
		align-self: stretch;
		padding: var(--space-1) 0 var(--space-2-5);
		border-top: 1px solid var(--color-border);
	}
	.roll-note {
		padding: 0 var(--space-4) var(--space-2);
		font-size: var(--font-size-xs);
		color: var(--color-accent-bright);
	}
</style>
