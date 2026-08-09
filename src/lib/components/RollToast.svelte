<script lang="ts">
	// The dice-roll toast (design 5A, "the toast grows with the roll"). The summary lives in its own
	// full-height column on the right — ONE big number however many rows there are — so a stack of
	// toasts lines its totals up even at different heights. Uppercase row labels only switch on from
	// the second row: a single roll needs no caption, and stays a one-liner.
	// The model is built in $lib/dice/roll-toast.ts; this file is markup + tokens only.
	import type { RollToastModel, RollToastRow } from '$lib/dice/roll-toast';
	import type { DieChip } from '$lib/rules/dice';
	import { signed } from '$lib/util/format';

	// `closeToast` is injected by svelte-sonner for a custom-component toast — which is also why it
	// drops its own close button, so the card itself has to be the dismiss affordance.
	let { model, closeToast }: { model: RollToastModel; closeToast?: () => void } = $props();

	const rows = $derived(model.rows);
	const first = $derived(rows[0]);
	// one unlabelled row and nothing to flag → the compact single-line form (name, dice, mod inline)
	const compact = $derived(rows.length === 1 && !model.tag && !model.note && !first?.dropped);
	// a die that came up max reads as gold, a 1 as spent — the d20 says it loudest (it decides things)
	const tone = (c: DieChip) =>
		c.value === c.sides ? 'max' : c.value === 1 ? 'min' : ('' as const);
</script>

{#snippet dice(row: RollToastRow)}
	<span class="rt-dice">
		{#each row.chips as c, i (i)}
			<span class="rt-die {tone(c)}" class:d20={c.sides === 20} title="d{c.sides} · {c.detail}"
				>{c.sign < 0 ? '−' : ''}{c.value}</span
			>
		{/each}
		{#if row.dropped !== undefined}
			<span class="rt-die dropped" title="dropped d20">{row.dropped}</span>
		{/if}
		{#if row.mod}<span class="rt-mod">{signed(row.mod)}</span>{/if}
	</span>
{/snippet}

<div
	class="rolltoast"
	class:gold={model.emphasis === 'gold'}
	class:bad={model.emphasis === 'danger'}
>
	<!-- the roll itself is a real <button>, not a div with a role: it IS the dismiss target (see
	     closeToast above). The offer below is its sibling — a button can't nest inside a button. -->
	<button
		type="button"
		class="rt-main"
		class:dismissible={closeToast}
		aria-label="{model.label} — {model.total}{closeToast ? '. Dismiss' : ''}"
		title={closeToast ? 'Dismiss' : undefined}
		onclick={closeToast}
	>
		<div class="rt-body">
			{#if compact}
				<div class="rt-line">
					<span class="rt-name">{model.label}</span>
					{#if first}{@render dice(first)}{/if}
				</div>
			{:else}
				<div class="rt-title">
					<span class="rt-name">{model.label}</span>
					{#if model.tag}<span class="rt-tag eyebrow {model.tag.tone}">{model.tag.text}</span>{/if}
				</div>
				{#if rows.length === 1 && first}
					{@render dice(first)}
				{:else}
					<div class="rt-rows">
						{#each rows as row, i (i)}
							<span class="rt-rowlabel eyebrow">{row.label}</span>
							{@render dice(row)}
							<span class="rt-sub">{row.subtotal}</span>
						{/each}
					</div>
				{/if}
				{#if model.note}<div class="rt-note">⇡ {model.note}</div>{/if}
			{/if}
		</div>
		<div class="rt-total">
			<span class="rt-num" class:big={rows.length > 1}>{model.total}</span>
			{#if model.caption}<span class="rt-cap eyebrow">{model.caption}</span>{/if}
		</div>
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
	.rolltoast {
		display: flex;
		flex-direction: column;
		/* sonner only sizes toasts it styles itself, and a custom component opts out of that — so take
		   its `--width` directly, or the card shrink-wraps and a stack stops lining its totals up */
		width: var(--width, 356px);
		max-width: 100%;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-2);
	}
	/* the roll row: body + summary column, and the close button (sonner hides its own here) */
	.rt-main {
		display: flex;
		width: 100%;
		padding: 0;
		font: inherit;
		text-align: left;
		background: transparent;
		border: 0;
		border-radius: inherit;
		color: inherit;
	}
	.rt-main.dismissible {
		cursor: pointer;
	}
	.rolltoast:has(.rt-main.dismissible:hover) {
		border-color: var(--color-border-strong);
	}
	/* a natural 20 / 1 re-tints the card edge + the summary; nothing else moves */
	.rolltoast.gold {
		border-color: var(--color-resource-line);
	}
	.rolltoast.bad {
		border-color: var(--color-danger);
	}
	.rt-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 11px 14px;
		min-width: 0;
	}
	/* the one-liner: name and dice on the same baseline */
	.rt-line {
		display: flex;
		align-items: center;
		gap: 9px;
		min-width: 0;
	}
	/* on the one-liner the dice follow the name directly (no flex push) — the name still ellipsises */
	.rt-line .rt-name {
		flex: 0 1 auto;
	}
	.rt-title {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.rt-name {
		font-family: var(--font-display);
		font-size: var(--font-size-body);
		font-weight: 600;
		color: var(--color-text);
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rt-tag {
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
	.rt-tag.good {
		color: var(--color-good);
	}
	.rt-tag.gold {
		color: var(--color-resource);
	}
	.rt-tag.danger {
		color: var(--color-danger);
	}
	/* label | dice | subtotal — the subtotals sit in their own column, subordinate to the big number */
	.rt-rows {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 7px 12px;
	}
	.rt-rowlabel {
		font-size: var(--font-size-micro);
	}
	.rt-sub {
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}
	.rt-dice {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 5px;
		min-width: 0;
	}
	.rt-die {
		display: inline-flex;
		align-items: center;
		justify-content: center;
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
	}
	.rt-note {
		font-size: var(--font-size-xs);
		color: var(--color-accent-bright);
	}
	/* the summary column: fixed width so stacked toasts align their numbers, full height by default */
	.rt-total {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3px;
		width: 76px;
		flex: none;
		border-left: 1px solid var(--color-border);
	}
	.gold .rt-total {
		border-left-color: var(--color-resource-line);
	}
	.bad .rt-total {
		border-left-color: var(--color-danger);
	}
	.rt-num {
		font-family: var(--font-display);
		font-size: var(--font-size-h3);
		font-weight: 700;
		line-height: 1;
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
	}
	.rt-num.big {
		font-size: var(--font-size-h2);
	}
	.gold .rt-num {
		color: var(--color-resource);
	}
	.bad .rt-num {
		color: var(--color-danger);
	}
	.rt-cap {
		font-size: var(--font-size-micro);
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
