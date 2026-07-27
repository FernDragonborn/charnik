<script lang="ts">
	// Review & create bar: a live snapshot of the derived sheet (AC / HP / init / speed / prof /
	// spell DC), blocking issues, missing-content flags, and the create/save action.
	import { build } from '../state.svelte';
	import { signed } from '$lib/util/format';

	// the parent owns navigation-on-save (goto Combat); this bar just triggers it.
	let { create }: { create: () => void } = $props();
	const b = build;
</script>

<div class="card review">
	<h2 class="review-title">
		{b.edit ? 'Review & save' : 'Review & create'}
		<span class="count gold">Level {b.sheet?.level ?? b.totalLevel}</span>
	</h2>
	<div class="revgrid">
		{#if b.sheet}
			<div class="stats">
				<div class="stat"><b>{b.sheet.ac.value}</b><small>AC</small></div>
				<div class="stat"><b>{b.sheet.maxHp.value}</b><small>Max HP</small></div>
				<div class="stat"><b>{signed(b.sheet.initiative.value)}</b><small>Init</small></div>
				<div class="stat"><b>{b.sheet.speed.value}</b><small>Speed</small></div>
				<div class="stat"><b>{signed(b.sheet.proficiencyBonus)}</b><small>Prof</small></div>
				{#if b.sheet.spellcasting.classes[0]}<div class="stat"><b>{b.sheet.spellcasting.classes[0].saveDC.value}</b><small>Spell DC</small></div>{/if}
			</div>
		{/if}
		<div class="revside">
			{#if b.issues.length}
				<ul class="issues">{#each b.issues as msg (msg)}<li>{msg}</li>{/each}</ul>
			{:else}
				<p class="subtext ready">Ready to create.</p>
			{/if}
			{#if b.sheet?.missing.length}
				<p class="subtext warn">Missing content: {b.sheet.missing.join(', ')}</p>
			{/if}
			<button class="create wide" disabled={!b.canCreate || b.saving} onclick={create}>
				{b.saving ? 'Saving…' : b.edit ? '✦ Save changes' : '✦ Create character'}
			</button>
		</div>
	</div>
</div>

<style>
	.review {
		margin-top: 18px;
		background: linear-gradient(180deg, var(--color-accent-soft), var(--color-surface));
		border-color: var(--color-accent-deep);
	}
	.review .review-title {
		color: var(--color-accent-bright);
	}
	.revgrid {
		display: grid;
		grid-template-columns: 2fr 1fr;
		gap: 18px;
		align-items: center;
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 10px;
	}
	.stat {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 10px;
		padding: 10px;
		text-align: center;
	}
	.stat b {
		display: block;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 22px;
	}
	.stat small {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
	}
	.revside {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.issues {
		margin: 0;
		padding-left: 16px;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.issues li {
		margin: 2px 0;
	}
	.create {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-sm);
		background: var(--color-accent-deep);
		border: 1px solid var(--color-accent-deep);
		color: var(--color-accent-text);
		border-radius: 9px;
		padding: 9px 16px;
		cursor: pointer;
	}
	.create:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.create.wide {
		width: 100%;
		padding: 11px;
	}

	@media (max-width: 760px) {
		.revgrid {
			grid-template-columns: 1fr;
		}
	}
</style>
