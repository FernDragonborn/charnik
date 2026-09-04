<script lang="ts">
	// What this character can actually do on their turn, built from the same `computeAttacks` the
	// combat view uses — so the row you see while building is the row you get while playing. Equipping
	// a weapon in the inventory pane changes this list immediately; that is the point of showing it
	// here rather than after the character exists.
	import { _ } from '$lib/i18n';
	import { build } from '../build-view-model.svelte';
	import { attackName, computeAttacks, formatDamageParts } from '$lib/combat/attacks';
	import { app } from '$lib/stores/app.svelte';
	import { signed } from '$lib/util/format';
	const b = build;

	const attacks = $derived(
		b.sheet && b.graph ? computeAttacks(b.assembled, b.sheet, b.graph, app.activeLocale) : []
	);
	const extraAttacks = $derived(b.sheet?.facts.numeric.filter((f) => f.target === 'attacks') ?? []);
	const perTurn = $derived(1 + extraAttacks.reduce((n, f) => n + (f.amount ?? 0), 0));
</script>

<div class="card">
	<div class="card-head">
		<span class="eyebrow">{$_('build.attacks.title')}</span>
		<span class="spacer"></span>
		<span class="trail">{$_('build.attacks.perTurn', { values: { count: perTurn } })}</span>
		<button
			class="pill-btn"
			class:accent={b.inspector.isOpen({ id: 'inventory' })}
			onclick={() => b.inspector.toggle({ id: 'inventory' })}
			>{$_('build.attacks.equipment')}</button
		>
	</div>

	{#if attacks.length}
		<!-- four columns with a header each IS a table, and a screen reader that is told so reads
		     "Damage, 1d8+3" instead of a loose run of spans. The rows are `subgrid`, so saying it costs
		     the wrapper the roles need and not one pixel of the alignment. -->
		<div class="atks" role="table" aria-label={$_('build.attacks.title')}>
			<div class="arow" role="row">
				<span class="eyebrow h" role="columnheader">{$_('build.attacks.colAttack')}</span>
				<span class="eyebrow h" role="columnheader">{$_('build.attacks.colToHit')}</span>
				<span class="eyebrow h" role="columnheader">{$_('build.attacks.colDamage')}</span>
				<span class="eyebrow h" role="columnheader">{$_('build.attacks.colNotes')}</span>
			</div>
			<!-- keyed on the id AND the position: two sources can ship the same weapon id, and a
			     duplicate key is a crash rather than a wrong row -->
			{#each attacks as a, i (`${a.id}-${i}`)}
				<div class="arow" role="row">
					<b class="aname" role="cell">{attackName(a, $_)}</b>
					<span class="hit" role="cell">{signed(a.toHit)}</span>
					<span class="dmg" role="cell">{formatDamageParts(a.damageParts, $_)}</span>
					<span class="ameta" role="cell">{[a.meta, a.note].filter(Boolean).join(' · ')}</span>
				</div>
			{/each}
		</div>
	{:else}
		<p class="subtext">{$_('build.attacks.empty')}</p>
	{/if}
</div>

<style>
	.atks {
		display: grid;
		grid-template-columns: minmax(0, 1.3fr) auto minmax(0, 0.9fr) minmax(0, 1.6fr);
		gap: var(--space-1-5) 14px;
		font-size: var(--font-size-xs);
	}
	/* the row wrapper the table roles need; `subgrid` keeps the four columns measured across the whole
	   list rather than per row, and inherits the gaps with them */
	.arow {
		display: grid;
		grid-column: 1 / -1;
		grid-template-columns: subgrid;
		align-items: baseline;
	}
	.eyebrow.h {
		font-size: var(--font-size-micro);
	}
	.aname {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
	.hit {
		font-family: var(--font-mono);
		color: var(--color-accent-bright);
	}
	.dmg {
		font-family: var(--font-mono);
	}
	.ameta {
		color: var(--color-text-muted);
	}
</style>
