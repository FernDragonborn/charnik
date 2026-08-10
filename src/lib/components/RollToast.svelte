<script lang="ts">
	// The dice-roll toast (final design — design-preview/toast-update/"Roll Toasts Final").
	// The card shrinks to its own content (260–400px) instead of sitting at a fixed width, and every
	// roll is ONE grid row: the d20 and what it came to on the left, the damage it dealt in the
	// middle, the number that matters big on the right. Several attacks resolved as one action get a
	// row each plus a per-type footer. What the die did is the only thing that gets colour — gold for
	// a nat 20, red for a nat 1 (the one miss callable without knowing the target's AC).
	// The model is built in $lib/dice/roll-toast.ts; this file is markup + tokens only.
	import type { RollToastModel, RollToastAttack, RollToastDamage } from '$lib/dice/roll-toast';
	import type { DieChip } from '$lib/rules/dice';
	import DamageIcon from './DamageIcon.svelte';
	import { signed } from '$lib/util/format';

	// `closeToast` is injected by svelte-sonner for a custom-component toast — which is also why it
	// drops its own close button, so the card itself has to be the dismiss affordance.
	let { model, closeToast }: { model: RollToastModel; closeToast?: () => void } = $props();

	const attacks = $derived(model.attacks);
	const multi = $derived(attacks.length > 1 && model.damaging);
	// a die that came up max reads as gold, a 1 as spent — the d20 says it loudest (it decides things)
	const tone = (c: DieChip) =>
		c.value === c.sides ? 'max' : c.value === 1 ? 'min' : ('' as const);
	const face = (c: DieChip) => `${c.sign < 0 ? '−' : ''}${c.value}`;
</script>

{#snippet hitDice(a: RollToastAttack)}
	<span class="rt-hit">
		{#each a.chips as c, i (i)}
			<span class="rt-die {tone(c)}" class:d20={c.sides === 20} title="d{c.sides} · {c.detail}"
				>{face(c)}</span
			>
		{/each}
		{#if a.dropped !== undefined}
			<span class="rt-die dropped" title="dropped d20">{a.dropped}</span>
		{/if}
		{#if a.mod}<span class="rt-mod">{signed(a.mod)}</span>{/if}
	</span>
{/snippet}

<!-- one damage type: glyph, then its dice in a SINGLE pill (a crit's doubled dice share it, divided),
     then the flat mod. A dice-less part (a fixed "1 bludgeoning") puts its value in the pill. -->
{#snippet damagePart(d: RollToastDamage)}
	<span class="rt-part" title={d.type || undefined}>
		<DamageIcon type={d.type} />
		<span class="rt-die">
			{#if d.chips.length}
				{#each d.chips as c, i (i)}
					{#if i}<span class="rt-div"></span>{/if}
					<span title="d{c.sides} · {c.detail}">{face(c)}</span>
				{/each}
			{:else}
				<span>{d.total}</span>
			{/if}
		</span>
		{#if d.mod && d.chips.length}<span class="rt-mod">{signed(d.mod)}</span>{/if}
	</span>
{/snippet}

<div class="rolltoast">
	<!-- the roll itself is a real <button>, not a div with a role: it IS the dismiss target (see
	     closeToast above). The offer below is its sibling — a button can't nest inside a button. -->
	<button
		type="button"
		class="rt-card"
		class:dismissible={closeToast}
		aria-label="{model.label} — {model.total}{closeToast ? '. Dismiss' : ''}"
		title={closeToast ? 'Dismiss' : undefined}
		onclick={closeToast}
	>
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
							{#each a.damage as d, j (j)}{@render damagePart(d)}{/each}
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
		{#if model.note}<span class="rt-note">⇡ {model.note}</span>{/if}
	</button>
	{#if model.action}
		<button
			type="button"
			class="rt-action"
			onclick={() => {
				model.action?.run();
				closeToast?.();
			}}>{model.action.label}</button
		>
	{/if}
</div>

<style>
	/* sonner only sizes toasts it styles itself, and a custom component opts out of that — the <li>
	   shrink-wraps, so a card that sizes to its own content would drift to the left edge of the
	   toaster column. Give the li a band to centre the card in. The band is the design's 400px max,
	   wider than sonner's own column, so pull it back half the difference and the roll toasts stay
	   centred on the same axis as every other toast. */
	:global([data-sonner-toast]:has(> .rolltoast)) {
		display: flex;
		justify-content: center;
		width: 400px;
		margin-left: calc((var(--width) - 400px) / 2);
	}
	/* under 600px sonner takes the li full-width itself — don't fight it, just stop shifting */
	@media (max-width: 600px) {
		:global([data-sonner-toast]:has(> .rolltoast)) {
			width: 100%;
			margin-left: 0;
		}
	}
	/* the card sizes to its content: a bare check stays narrow, a three-attack flurry grows */
	.rolltoast {
		display: flex;
		flex-direction: column;
		width: max-content;
		min-width: 260px;
		max-width: 100%;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-2);
		overflow: hidden;
	}
	.rt-card {
		display: flex;
		flex-direction: column;
		padding: 0;
		font: inherit;
		text-align: left;
		background: transparent;
		border: 0;
		border-radius: inherit;
		color: inherit;
	}
	.rt-card.dismissible {
		cursor: pointer;
	}
	.rolltoast:has(.rt-card.dismissible:hover) {
		border-color: var(--color-border-strong);
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
	/* one row per attack. The fixed-ish columns let a stack of toasts read down the same seams; they
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
	/* the roll's own follow-up offer (Savage Attacker's reroll) — a full-width bar under the roll it
	   belongs to, so the damage being judged stays on screen instead of behind a second toast */
	.rt-action {
		border: 0;
		border-top: 1px solid var(--color-border);
		border-radius: 0 0 var(--radius) var(--radius);
		padding: 7px 14px;
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		text-align: left;
		color: var(--color-accent-bright);
		background: var(--color-accent-soft);
		cursor: pointer;
	}
	.rt-action:hover {
		color: var(--color-text);
		background: var(--color-accent);
	}
</style>
