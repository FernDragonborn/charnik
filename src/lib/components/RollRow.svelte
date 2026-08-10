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
	import {
		ROLL_LAYOUT,
		type RollLayout,
		type RollToastModel,
		type RollToastAttack,
		type RollToastDamage
	} from '$lib/dice/roll-toast';
	import type { DieChip } from '$lib/rules/dice';
	import DamageIcon from './DamageIcon.svelte';
	import { signed } from '$lib/util/format';

	let {
		model,
		onAdvantage,
		rerollDamage,
		layout = ROLL_LAYOUT.card
	}: {
		model: RollToastModel;
		/** Present → the d20 pill becomes a control that applies advantage AFTER the fact (UX-3): tap
		 *  it and a second d20 joins the first. Absent → every pill is inert, which is how the toast
		 *  mounts it (a toast expires mid-decision, so it announces and the Playbar/log control). No
		 *  attack index: a volley can't offer a per-attack chooser until something rolls more than one
		 *  attack (blocked on ROLLER-N), and shipping one that can't be exercised is how it goes wrong. */
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

	const attacks = $derived(model.attacks);
	const multi = $derived(attacks.length > 1 && model.damaging);
	// a die that came up max reads as gold, a 1 as spent — the d20 says it loudest (it decides things)
	const tone = (c: DieChip) =>
		c.value === c.sides ? 'max' : c.value === 1 ? 'min' : ('' as const);
	const face = (c: DieChip) => `${c.sign < 0 ? '−' : ''}${c.value}`;

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
	const cueShape = (a: RollToastAttack) =>
		a.advantageMode === 1 ? 'up' : a.advantageMode === -1 ? 'down' : 'none';
	const cueTitle = (a: RollToastAttack) =>
		a.advantageMode === 1
			? 'rolled with advantage — tap for disadvantage'
			: a.advantageMode === -1
				? 'rolled with disadvantage — tap to undo'
				: 'roll a second d20 and keep the better — advantage';

	/**
	 * One line can hold a bounded number of pills, and a pool is NOT bounded — a Fireball is 8d6, a
	 * Meteor Swarm 40. So the strip keeps the dice that are load-bearing and folds the rest into a
	 * count: the d20 stays because it decides the roll AND is the advantage control, everything else
	 * becomes `8d6`, which is what a player would say out loud anyway. The card keeps every die, and
	 * the log is one tap away — the die-by-die breakdown is audit information, the same reasoning the
	 * design already applies to a volley's rows.
	 */
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
	<span
		class="rt-hit"
		class:adv={a.advantageMode === 1}
		class:dis={a.advantageMode === -1}
		title={a.advantageMode === 1
			? 'rolled with advantage'
			: a.advantageMode === -1
				? 'rolled with disadvantage'
				: undefined}
	>
		{#each shownChips(a) as c, i (i)}
			{#if c.sides === 20 && i === 0 && canAmend(a)}
				<button
					type="button"
					class="rt-die d20 control {tone(c)}"
					title={cueTitle(a)}
					onclick={() => onAdvantage?.()}
					>{face(c)}<span class="rt-cue {cueShape(a)}"></span></button
				>
			{:else}
				<span class="rt-die {tone(c)}" class:d20={c.sides === 20} title="d{c.sides} · {c.detail}"
					>{face(c)}</span
				>
			{/if}
		{/each}
		{#if a.dropped !== undefined}
			<span class="rt-die dropped" title="dropped d20">{a.dropped}</span>
		{/if}
		{#if foldedDice(a)}
			<span class="rt-die folded" title={a.chips.map((c) => c.detail).join(' + ')}
				>{foldedDice(a)}</span
			>
		{/if}
		{#if a.mod}<span class="rt-mod">{signed(a.mod)}</span>{/if}
	</span>
{/snippet}

<!-- one damage type: glyph, then its dice in a SINGLE pill (a crit's doubled dice share it, divided),
     then the flat mod. A dice-less part (a fixed "1 bludgeoning") puts its value in the pill. -->
{#snippet damagePart(d: RollToastDamage, attack: number, part: number)}
	{@const re =
		rerollDamage && rerollDamage.attack === attack && rerollDamage.part === part
			? rerollDamage
			: undefined}
	<span class="rt-part" title={d.type || undefined}>
		<DamageIcon type={d.type} />
		<svelte:element
			this={re ? 'button' : 'span'}
			role={re ? 'button' : undefined}
			type={re ? 'button' : undefined}
			class="rt-die"
			class:control={re}
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
					{#if i}<span class="rt-div"></span>{/if}
					<span title="d{c.sides} · {c.detail}">{face(c)}</span>
				{/each}
			{:else}
				<span>{d.total}</span>
			{/if}
			{#if re}<span class="rt-cue">↻</span>{/if}
		</svelte:element>
		{#if d.mod && d.chips.length && !strip}<span class="rt-mod">{signed(d.mod)}</span>{/if}
	</span>
{/snippet}

<div class="rollrow" class:strip title={strip && model.note ? model.note : undefined}>
	<span class="rt-name">{model.label}</span>
	{#if strip && multi}
		<!-- a volley cannot flow inline: three attacks each with their own dice and damage types is a
		     two-dimensional thing, and forcing it onto one line is exactly the overlap this layout
		     exists to avoid. A strip says WHAT happened and how much; the card and the log carry the
		     attack-by-attack breakdown. (Nothing rolls a volley yet — blocked on ROLLER-N — but the
		     gallery renders one, and it must not be the shape that ships.) -->
		<span class="rt-grid volley">
			<span class="rt-mod">{attacks.length} attacks</span>
			{#each model.byType as t, i (i)}
				<span class="rt-typesum" title={t.type || undefined}>
					<DamageIcon type={t.type} size={14} /><span>{t.total}</span>
				</span>
			{/each}
			<span class="rt-tot big">{model.total}</span>
		</span>
	{:else}
		<span class="rt-grid" class:damaging={model.damaging} class:multi>
			<!-- the captions name the two NUMBERS, not the dice: "to hit" spans the dice columns so its
		     own width can't widen them, and lands on the to-hit total's right edge. -->
			{#if model.damaging}
				<span class="rt-cap hit eyebrow">to hit</span>
				<span></span>
				<span class="rt-cap eyebrow">damage</span>
			{/if}
			{#each attacks as a, i (i)}
				{#if multi}<span class="rt-idx" class:gold={a.natural === 20}>{i + 1}</span>{/if}
				{@render hitDice(a)}
				{#if model.damaging}
					<span class="rt-sub" class:gold={a.natural === 20} class:bad={a.natural === 1}
						>{a.subtotal}</span
					>
					<span class="rt-dmg">
						{#if a.natural === 1}
							<span class="rt-none">—</span>
						{:else}
							{#each a.damage as d, j (j)}{@render damagePart(d, i, j)}{/each}
						{/if}
					</span>
				{/if}
				<span
					class="rt-tot"
					class:big={!multi}
					class:gold={a.natural === 20}
					class:bad={a.natural === 1}
				>
					{#if !model.damaging}{a.subtotal}{:else if a.natural === 1}<span class="rt-miss"
							>miss</span
						>{:else}{a.damageTotal}{/if}
				</span>
			{/each}
			{#if multi}
				<span class="rt-bytype">
					{#each model.byType as t, i (i)}
						<span class="rt-typesum" title={t.type || undefined}>
							<DamageIcon type={t.type} size={14} /><span>{t.total}</span>
						</span>
					{/each}
				</span>
				<span class="rt-tot big grand">{model.total}</span>
			{/if}
		</span>
	{/if}
	<!-- the note is a RECORD (an upcast's provenance, an amendment) and records belong in the log,
	     which is one tap away and renders it in full. On a one-line strip it is permanent space for a
	     few seconds of value, and for an amendment it is redundant besides: the green/red frame and
	     the struck-through die already say the roll was changed. Kept as the strip's tooltip. -->
	{#if model.note && !strip}<span class="rt-note">⇡ {model.note}</span>{/if}
</div>

<style>
	/* the roll owns its own stacking now — a mounting surface just gives it a box, it doesn't have to
	   know that a roll is three sibling spans */
	.rollrow {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	/* one line: the label sits beside the numbers, the column captions fold away (they title columns
	   that no longer exist as a grid), and the totals stop being display-sized */
	.rollrow.strip {
		flex-direction: row;
		align-items: center;
	}
	/* the label yields FIRST when the strip runs out of room: you just rolled it, and the log keeps it
	   in full. Everything to its right is either a control or a number, and neither can be ellipsised. */
	.strip .rt-name {
		flex: 0 1 auto;
		min-width: 3ch;
		padding: 8px 4px 8px 13px;
	}
	.strip .rt-grid,
	.strip .rt-grid.damaging,
	.strip .rt-grid.multi,
	.strip .rt-grid.volley {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 0 4px;
	}
	.strip .rt-cap {
		display: none;
	}
	.strip .rt-hit,
	.strip .rt-dmg {
		padding: 0;
		border-left: 0;
	}
	.strip .rt-sub {
		padding-right: 0;
	}
	.strip .rt-tot,
	.strip .rt-tot.big {
		padding: 0 11px;
		font-size: var(--font-size-body);
		border-left: 1px solid var(--color-border);
	}

	.rt-name {
		padding: 11px 16px 9px;
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
	.rt-grid {
		display: grid;
		grid-template-columns: 1fr 58px;
		align-items: center;
		padding: 0 0 6px 16px;
	}
	.rt-grid.damaging {
		grid-template-columns: minmax(58px, max-content) minmax(36px, max-content) 1fr 58px;
	}
	.rt-grid.multi {
		grid-template-columns: 26px minmax(58px, max-content) minmax(36px, max-content) 1fr 58px;
		padding-left: 0;
	}
	.rt-cap {
		padding: 0 0 5px;
		font-size: var(--font-size-micro);
		text-align: center;
	}
	.rt-cap.hit {
		grid-column: 1 / 3;
		padding-right: 12px; /* the to-hit total's own padding — the caption sits on its right edge */
		text-align: right;
	}
	.multi .rt-cap.hit {
		grid-column: 1 / 4;
	}
	/* which attack of the volley this is — a bare ordinal, gold when that one crit */
	.rt-idx {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 6px 0;
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}
	.rt-hit {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		padding: 6px 0;
	}
	/* HOW the d20 was rolled is the one thing you cannot read off the numbers, so it frames the pair
	   rather than tinting a die — the dice keep their own nat-20 gold / nat-1 red, which says what the
	   die DID. Green for advantage, red for disadvantage. */
	.rt-hit.adv,
	.rt-hit.dis {
		margin: 2px 0;
		padding: 2px 6px;
		border-radius: var(--radius-full);
		border: 2px solid var(--color-good);
	}
	.rt-hit.dis {
		border-color: var(--color-danger);
	}
	.rt-die {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		min-width: 23px;
		height: 22px;
		padding: 0 6px;
		border-radius: var(--radius-sm);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border-strong);
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
	}
	/* several dice of one damage type share a pill — a crit's doubled d8s are one thing, not two */
	.rt-div {
		width: 1px;
		height: 12px;
		background: var(--color-border-strong);
	}
	.rt-die.max {
		background: var(--color-resource-soft);
		border-color: var(--color-resource-line);
		color: var(--color-resource);
	}
	.rt-die.min {
		color: var(--color-text-muted);
	}
	/* the d20 decides things — its extremes get the full-strength edge, not just tinted text */
	.rt-die.d20.max {
		border-color: var(--color-resource);
		font-weight: 700;
	}
	.rt-die.d20.min {
		background: var(--color-danger-soft);
		border-color: var(--color-danger);
		color: var(--color-danger);
		font-weight: 700;
	}
	/* the adv/disadv die that lost: smaller, struck through, no fill */
	.rt-die.dropped {
		min-width: 19px;
		height: 18px;
		padding: 0 5px;
		background: transparent;
		color: var(--color-text-muted);
		text-decoration: line-through;
	}
	/* An interactive pill must LOOK like one ([[charnik-interactive-affordance]]): its own edge, a
	   cursor, a hover, a focus ring and a glyph saying what tapping does. The edge is DASHED rather
	   than coloured, because green and red are spoken for — they say how the d20 was rolled — and a
	   third meaning in the same palette would read as a roll outcome. Inert pills are untouched, so
	   there is never a false affordance. */
	.rt-die.control {
		gap: 2px;
		padding-right: 4px;
		border-style: dashed;
		border-color: var(--color-border-strong);
		cursor: pointer;
	}
	/* The three cue shapes, clipped out of a solid box rather than typed as a character: at this size a
	   font glyph has no vertical stem for the rasteriser to align to, so its diagonals blur into a lump.
	   A clipped box is the exact geometry we asked for, at a size we control, in currentColor.
	   No third colour: each shape wears the colour of the state it reports, so teal and red keep meaning
	   exactly what they mean on the frame. The neutral diamond stays uncoloured, which is why it can be
	   the affordance marker without claiming a state. */
	.rt-cue.up,
	.rt-cue.down,
	.rt-cue.none {
		width: 8px;
		height: 8px;
		background: currentColor;
	}
	.rt-cue.up {
		clip-path: polygon(50% 0%, 100% 100%, 0% 100%);
		color: var(--color-good);
	}
	.rt-cue.down {
		clip-path: polygon(0% 0%, 100% 0%, 50% 100%);
		color: var(--color-danger);
	}
	.rt-cue.none {
		clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
		color: var(--color-text-muted);
	}
	.rt-die.control:hover {
		border-color: var(--color-accent);
		background: var(--color-accent-soft);
	}
	.rt-die.control:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
	}
	.rt-cue {
		font-size: var(--font-size-micro);
		line-height: 1;
		opacity: 0.8;
	}
	/* the folded pool ("8d6") is a count, not a result — it reads as a caption, not as a die face */
	.rt-die.folded {
		background: transparent;
		border-style: dashed;
		color: var(--color-text-muted);
		font-weight: 500;
	}
	.rt-mod {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	/* what the to-hit came to — subordinate to the damage, which is the number being read */
	.rt-sub {
		padding-right: 12px;
		text-align: right;
		font-family: var(--font-display);
		font-size: var(--font-size-body);
		font-weight: 600;
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
	}
	/* the damage half of the row: glyph-led chips, right-aligned against the total's rule, wrapping
	   onto a second line when a crit doubles the types */
	.rt-dmg {
		align-self: stretch;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 5px;
		padding: 6px 12px 6px 14px;
		border-left: 1px solid var(--color-border);
	}
	.rt-part {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		flex: none;
		white-space: nowrap;
	}
	.rt-none {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	/* the summary column: same width whatever the height, so a stack lines its numbers up */
	.rt-tot {
		align-self: stretch;
		display: flex;
		align-items: center;
		justify-content: center;
		border-left: 1px solid var(--color-border);
		font-family: var(--font-display);
		font-size: var(--font-size-body);
		font-weight: 600;
		line-height: 1;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}
	.rt-tot.big {
		padding-bottom: 6px;
		font-size: var(--font-size-h2);
		font-weight: 700;
		color: var(--color-text);
	}
	.rt-tot.gold,
	.rt-sub.gold,
	.rt-idx.gold {
		color: var(--color-resource);
	}
	.rt-tot.bad,
	.rt-sub.bad {
		color: var(--color-danger);
	}
	.rt-miss {
		font-size: var(--font-size-sm);
		font-weight: 600;
	}
	/* the volley's footer: what it dealt per type, then the one number that leaves the card */
	.rt-bytype {
		grid-column: 1 / 5;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 12px;
		padding: 7px 12px 11px 0;
	}
	.rt-typesum {
		display: flex;
		align-items: center;
		gap: 5px;
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.rt-typesum span {
		color: var(--color-text);
	}
	.rt-tot.grand {
		align-self: stretch;
		padding: 5px 0 11px;
		border-top: 1px solid var(--color-border);
	}
	.rt-note {
		padding: 0 16px 9px;
		font-size: var(--font-size-xs);
		color: var(--color-accent-bright);
	}
</style>
