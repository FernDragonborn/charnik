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
	{@const amend = canAmend(a)}
	<span class="roll-to-hit" title={hitKey ? $_(hitKey) : undefined}>
		<!-- the dice of the test, inside BRACKETS whose colour says how the d20 was read. The bracket
		     replaces both the per-die pill (two rounded boxes side by side read as two unrelated
		     values) and the cue-on-the-die: one mark around the group says "these were rolled together
		     and this is the rule that picked one". The whole group is the advantage control when the
		     surface passes one, which is why the affordance cue stays for the neutral state. -->
		<svelte:element
			this={amend ? 'button' : 'span'}
			role={amend ? 'button' : undefined}
			type={amend ? 'button' : undefined}
			class="roll-dice-group adv-{a.advantageMode ?? ADVANTAGE_MODE.neither}"
			class:tappable={amend}
			title={amend ? cueTitle(a) : undefined}
			onclick={amend ? () => onAdvantage?.() : undefined}
		>
			{#each shownChips(a) as c, i (i)}
				{#if i}<span class="roll-die-divider"></span>{/if}
				<span class="roll-face {tone(c)}" class:d20={c.sides === 20} title={dieTitle(c)}
					>{face(c)}</span
				>
			{/each}
			{#if a.dropped !== undefined}
				<!-- the die the rule threw away is a FACT about the roll, but not one of its answers: it
				     stays collapsed until the card is hovered or focused, then slides out dimmed beside the
				     die that won. Struck-through was the old treatment and lost: at this size the line
				     turns a digit into a blob. Where there is no hover (touch, or reduced motion) it is
				     simply always out — a state you cannot reach is a state that does not exist. -->
				<span class="roll-dropped">
					<span class="roll-die-divider"></span>
					<span class="roll-face dropped-die" title={$_('roller.droppedD20')}>{a.dropped}</span>
				</span>
			{/if}
			{#if foldedDice(a)}
				<span class="roll-face folded-dice" title={a.chips.map((c) => c.detail).join(' + ')}
					>{foldedDice(a)}</span
				>
			{/if}
			{#if amend}<span class="roll-cue advantage-cue advantage-cue-{cueShape(a)}"></span>{/if}
		</svelte:element>
		{#if a.mod}<span class="roll-modifier" title={modTitle(a.modParts)}>{signed(a.mod)}</span>{/if}
	</span>
{/snippet}

<!-- one damage type: glyph, then its dice in ONE bracket (a crit's doubled dice share it, divided),
     then the flat mod. A dice-less part (a fixed "1 bludgeoning") puts its value in the bracket. -->
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
			class="roll-dice-group"
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
				<span class="roll-face">{d.total}</span>
			{:else if d.chips.length}
				{#each d.chips as c, i (i)}
					{#if i}<span class="roll-die-divider"></span>{/if}
					<span class="roll-face" title={dieTitle(c)}>{face(c)}</span>
				{/each}
			{:else}
				<span class="roll-face">{d.total}</span>
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
	{:else if strip}
		<span
			class="roll-grid"
			class:damaging={twoPart}
			class:damage-only={model.damaging && !model.tested}
		>
			{#each attacks as a, i (i)}
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
					class="roll-total big-total"
					class:nat-20={a.natural === 20}
					class:nat-1={a.natural === 1}
				>
					{#if !model.damaging}{shown(a.subtotal)}{:else if a.natural === 1}<span class="roll-miss"
							>{$_('roller.miss')}</span
						>{:else}{a.damageTotal}{/if}
				</span>
			{/each}
		</span>
	{:else}
		<!-- Each ANSWER gets a box that names it and holds the arithmetic that produced it, dimmed, on
		     its own baseline. The card used to print both totals at different weights with the captions
		     a row above the numbers they named, and the first playtest read it as one undifferentiated
		     wall of numbers: which of the two do you say to the DM. A box is the smallest thing that
		     binds a caption, a sum and its formula into one object the eye can take at once. -->
		<div class="roll-lanes">
			{#each attacks as a, i (i)}
				<div class="roll-lane">
					{#if multi}<span class="roll-attack-index" class:nat-20={a.natural === 20}>{i + 1}</span
						>{/if}
					{#if model.tested}
						<div class="roll-box">
							<span class="roll-caption eyebrow"
								>{$_(model.damaging ? 'roller.toHit' : 'roller.result')}</span
							>
							<span class="roll-answer">
								<span
									class="roll-answer-sum"
									class:nat-20={a.natural === 20}
									class:nat-1={a.natural === 1}>{shown(a.subtotal)}</span
								>
								<span class="roll-formula">{@render hitDice(a)}</span>
							</span>
						</div>
					{/if}
					{#if model.damaging}
						<div class="roll-box damage-box">
							<span class="roll-caption eyebrow">{$_('roller.damage')}</span>
							<span class="roll-answer">
								{#if a.natural === 1}
									<span class="roll-answer-sum nat-1 roll-miss">{$_('roller.miss')}</span>
								{:else}
									<span class="roll-answer-sum" class:nat-20={a.natural === 20}
										>{a.damageTotal}</span
									>
									<span class="roll-formula">
										{#each a.damage as d, j (j)}{@render damagePart(d, i, j)}{/each}
									</span>
								{/if}
							</span>
						</div>
					{/if}
				</div>
			{/each}
			<!-- a volley's own answer: what the whole action dealt, with the per-type split as its
			     formula — the same shape as a line's, so the card reads down one column of sums -->
			{#if multi}
				<div class="roll-lane">
					<div class="roll-box damage-box">
						<span class="roll-caption eyebrow"
							>{$_('roller.attacks', { values: { count: attacks.length } })}</span
						>
						<span class="roll-answer">
							<span class="roll-answer-sum">{shown(model.total)}</span>
							<span class="roll-formula">
								{#each model.byType as t, i (i)}
									<span class="roll-type-sum" title={damageTypeLabel(t.type, $_) || undefined}>
										<DamageIcon type={t.type} size={14} /><span>{t.total}</span>
									</span>
								{/each}
							</span>
						</span>
					</div>
				</div>
			{/if}
		</div>
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
	.strip .roll-to-hit,
	.strip .roll-damage {
		padding: 0;
		border-inline-start: 0;
	}
	.strip .roll-to-hit-total {
		padding-inline-end: 0;
	}
	.strip .roll-dice-group {
		margin-inline-start: 0;
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
	/* the strip's row — the one layout that still flows its parts inline */
	.roll-grid {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 0 var(--space-1);
	}

	/* ---- the card: a lane per attack, an answer per box ---- */
	.roll-lanes {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: 0 var(--space-4) var(--space-3);
	}
	/* NOT `flex-wrap: wrap`: the toast sizes itself with `width: max-content`, and a wrapping flex
	   container reports its largest ITEM as that — so the two halves stacked on a card with room for
	   both. They share the line and shrink; the phone case is the media query at the end. */
	.roll-lane {
		display: flex;
		align-items: stretch;
		gap: var(--space-2);
	}
	/* Each box is as wide as ITS content, not half the card: a to-hit box holds one bracket and a
	   modifier, a damage box can hold three types with their dice, and splitting the width evenly
	   left the first with slack while the second ran into the card's edge. They shrink (min-width: 0)
	   only where the card itself is capped. */
	.roll-box {
		flex: 0 1 auto;
		/* …down to a floor, so the two halves stay a PAIR. A miss puts one word in the damage box and
		   content-sizing alone shrank it to that word, leaving a card of two mismatched stubs. */
		min-width: 5.5rem;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-2) var(--space-2-5);
		background: var(--color-surface-2);
		border-radius: var(--radius);
	}
	/* The test's box carries less — one bracket and a modifier — and its formula cannot wrap, so it
	   neither grows past its content nor gives any of it back. Damage is what yields when the card is
	   tight, because damage is the half that CAN break onto another line. */
	.roll-box:not(.damage-box) {
		flex-shrink: 0;
	}
	/* damage reads on its own ground: with two boxes of identical weight side by side, the tint is
	   what lets a glance land on the half it wants before reading either caption. Its floor is the
	   higher of the two, because a miss leaves it holding one word. */
	.roll-box.damage-box {
		min-width: 7rem;
		background: color-mix(in srgb, var(--color-danger) 7%, var(--color-surface-2));
	}
	.roll-answer {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		min-width: 0;
	}
	/* THE number — the one thing said out loud. Both halves carry it at the same size: which one you
	   mean is the caption's job, and making one of them smaller only asks the question again. */
	.roll-answer-sum {
		/* never shrinks and never breaks: a flex item may be squeezed below its content, and a squeezed
		   number wraps BETWEEN ITS DIGITS — an 11 read as 1 and 1 down the card. The formula beside it
		   is what gives way instead. */
		flex: none;
		white-space: nowrap;
		font-family: var(--font-display);
		font-size: var(--font-size-xl);
		font-weight: 700;
		line-height: 1.05;
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
	}
	.roll-answer-sum.nat-20 {
		color: var(--color-resource);
	}
	.roll-answer-sum.nat-1 {
		color: var(--color-danger);
	}
	/* the arithmetic rides the sum's baseline, dimmed: it explains the number without competing with
	   it, and it is what expands when the card is hovered */
	/* The TEST's formula never wraps: wrapped, the box changes height when the dropped die slides out
	   and the lane jumps under the pointer that asked for it. Damage keeps wrapping — three types on
	   one line is the case that would otherwise run off the card. */
	.roll-formula .roll-to-hit {
		flex-wrap: nowrap;
	}
	.roll-formula {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-1);
		min-width: 0;
		opacity: 0.8;
	}
	.roll-formula .roll-to-hit,
	.roll-formula .roll-damage {
		padding: 0;
		border-inline-start: 0;
	}
	.roll-formula .roll-face {
		font-size: var(--font-size-xs);
	}
	.roll-formula .roll-dice-group::before,
	.roll-formula .roll-dice-group::after {
		font-size: var(--font-size-sm);
	}
	.roll-caption {
		font-size: var(--font-size-micro);
	}
	/* A damage part is ONE bracket and normally short, so it is laid out as an unbreakable run — but a
	   crit on a big pool is sixteen dice in that one bracket, and unbreakable meant it ran straight out
	   of the card. Inside a card's formula a DAMAGE part may wrap and its bracket with it.
	   Deliberately not the test's bracket (`.roll-to-hit` above stays `nowrap`): that one grows by a
	   few pixels when the dropped die slides out, and in a toast — narrower than the log — those pixels
	   were enough to fold the bracket into a second line mid-animation. The strip is untouched either
	   way, since it prints a part's total and never its dice. */
	.roll-formula .roll-damage-part,
	.roll-formula .roll-dice-group {
		flex-wrap: wrap;
		white-space: normal;
		/* and both must be ALLOWED to be narrower than their content, or wrapping never gets the chance:
		   a damage part is `flex: none` everywhere else (a strip's parts must not squeeze each other),
		   which kept it at its max-content width and ran a 20-die pool straight off the card. */
		flex: 0 1 auto;
		min-width: 0;
	}
	/* …except the ONE bracket whose width animates. The dropped die adds ~10px when it slides out, and
	   in a toast — narrower than the log — those pixels were enough to fold the bracket into a second
	   line for the length of the reveal. A pair of d20s has nothing to wrap anyway. */
	.roll-formula .roll-dice-group:has(.roll-dropped) {
		flex-wrap: nowrap;
	}
	/* on a phone the toast is the full width of a narrow screen, and two halves side by side leave
	   each one too little for its formula — so they stack instead of squeezing */
	@media (max-width: 600px) {
		.roll-lane {
			flex-direction: column;
		}
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
	/* Dice rolled together live inside ONE BRACKET — the test's, and each damage type's. It replaces
	   the per-die pill, where two rounded boxes side by side read as two unrelated values. On the test
	   the bracket also carries the colour: teal for advantage, red for disadvantage, quiet otherwise,
	   which is what makes a cue on the die itself unnecessary. */
	.roll-dice-group {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1);
		font: inherit;
		background: transparent;
		border: 0;
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
	}
	/* only the test's group has to line up with the label above it */
	.roll-to-hit > .roll-dice-group {
		margin-inline-start: calc(-1 * var(--space-1));
	}
	.roll-dice-group::before {
		content: '[';
	}
	.roll-dice-group::after {
		content: ']';
	}
	.roll-dice-group::before,
	.roll-dice-group::after {
		font-family: var(--font-display);
		font-size: var(--font-size-body);
		font-weight: 400;
		line-height: 1;
	}
	.roll-dice-group.adv-advantage {
		color: var(--color-good);
	}
	.roll-dice-group.adv-disadvantage {
		color: var(--color-danger);
	}
	/* A group is a control where the surface passes one — the test's bracket cycles advantage, a damage
	   bracket rerolls that part (docs/internals/ui.md ▸ Every interactive element says so). The glyph
	   riding the bracket is what marks it live, and the hover is a COLOURLESS wash: the bracket's colour
	   is a fact about the roll and must not be overwritten by a state of the pointer, and the theme's
	   crimson accent sits a shade away from the red that means disadvantage. What the tap DOES is the
	   group's title, which survives touch, where there is no hover at all. Inert groups are untouched,
	   so there is never a false affordance. */
	.roll-dice-group.tappable {
		cursor: pointer;
	}
	/* the cue is a marker on the GROUP, so it sits past the closing bracket rather than inside it
	   where it would read as one more die */
	.roll-dice-group .roll-cue {
		order: 1;
	}
	.roll-dice-group.tappable:hover {
		background: color-mix(in srgb, var(--color-text) 10%, transparent);
	}
	.roll-dice-group.tappable:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
	}
	/* one die face — a number, not a chip. Colour says what it did. */
	.roll-face {
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
	}
	.roll-face.max {
		color: var(--color-resource);
	}
	.roll-face.min {
		color: var(--color-text-muted);
	}
	/* the d20 decides things — its extremes are loud */
	.roll-face.d20.max {
		font-weight: 700;
	}
	.roll-face.d20.min {
		color: var(--color-danger);
		font-weight: 700;
	}
	/* the adv/disadv die that lost: dimmed and stepped back, never struck (see `.roll-dropped`) */
	.roll-face.dropped-die {
		color: var(--color-text-muted);
		font-weight: 500;
	}
	/* The loser is collapsed until the roll is hovered or focused: the bracket reads `[15]`, and
	   `[15 2]` once you ask.
	   Its SLOT is reserved the whole time — as padding on the line that holds the bracket — and the
	   reveal only trades that padding for the die's own width. The two are the same size, so the sum
	   never changes: the card cannot resize, and nothing around it can re-wrap while the pointer sits
	   on it. What moves is the bracket, sliding out over a die that was always there; what changes is
	   the clip. Anything else reflows the card mid-animation, and a wrapped neighbour flickering in and
	   out is what that looks like. */
	.roll-dropped {
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-1);
		width: var(--drop-slot);
		max-width: 0;
		opacity: 0;
		overflow: hidden;
		/* a zero-width flex item still takes the group's GAP, so the collapsed state held 4px of nothing
		   and pushed the closing bracket out — `[15 ]` where a one-die roll reads `[15]`. The negative
		   margin eats exactly that gap, in BOTH states, so the trade above stays exact. */
		margin-inline-start: calc(-1 * var(--space-1));
		/* the margin travels WITH the width: left instant, it snapped the whole bracket 4px right at the
		   first frame of the reveal. And the cap is 3ch, not a roomy 6 — max-width stops moving the
		   moment it passes the die's own width, so a cap far above it spent most of the duration
		   animating nothing while the fade ran on, which is what read as the slide ending early and the
		   rest catching up afterwards. */
		transition:
			max-width 140ms ease,
			opacity 140ms ease;
	}
	.roll-row:hover .roll-dropped,
	.roll-row:focus-within .roll-dropped {
		max-width: var(--drop-slot);
		opacity: 1;
	}
	/* the reserved half of the trade. `2.6ch` holds the widest thing a dropped d20 can be — two
	   tabular digits and the divider before them. */
	.roll-to-hit:has(.roll-dropped) {
		--drop-slot: 2.6ch;
		padding-inline-end: var(--drop-slot);
		transition: padding-inline-end 140ms ease;
	}
	.roll-row:hover .roll-to-hit:has(.roll-dropped),
	.roll-row:focus-within .roll-to-hit:has(.roll-dropped) {
		padding-inline-end: 0;
	}
	@media (hover: none) {
		.roll-dropped {
			max-width: var(--drop-slot);
			opacity: 1;
		}
		.roll-to-hit:has(.roll-dropped) {
			padding-inline-end: 0;
		}
	}
	/* the folded pool ("8d6") is a count, not a result — it reads as a caption, not as a die face */
	.roll-face.folded-dice {
		color: var(--color-text-muted);
		font-weight: 500;
	}
	/* several dice of one damage type share a bracket — a crit's doubled d8s are one thing, not two */
	.roll-die-divider {
		width: 1px;
		height: 12px;
		background: var(--color-border-strong);
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
	.roll-cue {
		font-size: var(--font-size-micro);
		line-height: 1;
		opacity: 0.8;
	}
	.roll-modifier {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	/* what the to-hit came to — subordinate to the damage, which is the number being read */
	.roll-to-hit-total {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-1);
		padding: 0 var(--space-3) 0 var(--space-2);
		font-family: var(--font-display);
		font-size: var(--font-size-body);
		font-weight: 700;
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
		gap: var(--space-1);
		font-family: var(--font-display);
		font-size: var(--font-size-body);
		font-weight: 600;
		line-height: 1;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}
	.roll-total.big-total {
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
	.roll-note {
		padding: 0 var(--space-4) var(--space-2);
		font-size: var(--font-size-xs);
		color: var(--color-accent-bright);
	}
</style>
