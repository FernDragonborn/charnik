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
	import type { RollToastModel, RollToastAttack, RollToastDamage } from '$lib/dice/roll-toast';
	import type { DieChip } from '$lib/rules/dice';
	import DamageIcon from './DamageIcon.svelte';
	import { signed } from '$lib/util/format';

	let {
		model,
		onAdvantage,
		rerollDamage
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
	} = $props();

	const attacks = $derived(model.attacks);
	const multi = $derived(attacks.length > 1 && model.damaging);
	// a die that came up max reads as gold, a 1 as spent — the d20 says it loudest (it decides things)
	const tone = (c: DieChip) =>
		c.value === c.sides ? 'max' : c.value === 1 ? 'min' : ('' as const);
	const face = (c: DieChip) => `${c.sign < 0 ? '−' : ''}${c.value}`;

	/** Which chip of an attack is THE d20 that decided it — the first positive one, matching what
	 *  `amendWithAdvantage` picks. -1 when the roll has no d20 to amend. */
	const d20Index = (a: RollToastAttack) => a.chips.findIndex((c) => c.sides === 20 && c.sign > 0);
	/** A roll already decided by two dice can't take advantage again. */
	const canAmend = (a: RollToastAttack) =>
		!!onAdvantage && a.dropped === undefined && d20Index(a) >= 0;
</script>

{#snippet hitDice(a: RollToastAttack)}
	<span class="rt-hit">
		{#each a.chips as c, i (i)}
			{#if i === d20Index(a) && canAmend(a)}
				<button
					type="button"
					class="rt-die d20 control {tone(c)}"
					title="d{c.sides} · {c.detail} — roll a second d20 and keep the better (advantage)"
					onclick={() => onAdvantage?.()}>{face(c)}<span class="rt-cue">⇈</span></button
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
			title={re ? re.label : undefined}
			onclick={re ? () => re.run() : undefined}
		>
			{#if d.chips.length}
				{#each d.chips as c, i (i)}
					{#if i}<span class="rt-div"></span>{/if}
					<span title="d{c.sides} · {c.detail}">{face(c)}</span>
				{/each}
			{:else}
				<span>{d.total}</span>
			{/if}
			{#if re}<span class="rt-cue">↻</span>{/if}
		</svelte:element>
		{#if d.mod && d.chips.length}<span class="rt-mod">{signed(d.mod)}</span>{/if}
	</span>
{/snippet}

<span class="rt-name">{model.label}</span>
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
			{#if !model.damaging}{a.subtotal}{:else if a.natural === 1}<span class="rt-miss">miss</span
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
{#if model.note}<span class="rt-note">⇡ {model.note}</span>{/if}

<style>
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
	/* An interactive pill must LOOK like one ([[charnik-interactive-affordance]]): its own accent
	   edge, a cursor, a hover, a focus ring and a glyph saying what tapping does. Inert pills are
	   untouched, so there is never a false affordance — that distinction is the whole reason a pill
	   can carry an action without reading as "a click somewhere in the card". */
	.rt-die.control {
		gap: 2px;
		padding-right: 4px;
		border-color: var(--color-accent);
		color: var(--color-accent-bright);
		cursor: pointer;
	}
	.rt-die.control:hover {
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
