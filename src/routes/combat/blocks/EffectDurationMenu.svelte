<script lang="ts">
	// Anchored dropdown for an effect's duration: a −/＋ stepper row on top, then the common-duration
	// presets and a Custom… exact-rounds input. Opens beside/below the `N rds ▾` control, clamped to
	// the viewport, and closes on backdrop click. Writes through the combat view-model.
	import { combat } from '../state.svelte';
	import { EFFECT_DURATION_PRESETS } from '$lib/combat/helpers';

	let {
		iid,
		rounds,
		anchor,
		onclose
	}: { iid: string; rounds: number | null; anchor: HTMLElement; onclose: () => void } = $props();

	let el = $state<HTMLDivElement>();
	let pos = $state({ top: 0, left: 0 });
	let custom = $state(false);
	let customValue = $state(10);
	// seed the custom input from the current duration when it's opened (avoids capturing the prop in $state)
	function openCustom() {
		customValue = rounds ?? 10;
		custom = true;
	}

	// Place the menu just below the control, right-aligned to it; pull left/up if it would overflow.
	$effect(() => {
		if (!el) return;
		const a = anchor.getBoundingClientRect();
		const w = el.offsetWidth;
		const h = el.offsetHeight;
		const margin = 8;
		let left = a.right - w;
		let top = a.bottom + 6;
		if (left < margin) left = margin;
		if (top + h > window.innerHeight - margin) top = Math.max(margin, a.top - h - 6);
		pos = { top, left };
	});

	function pick(value: number | null) {
		combat.setEffectDuration(iid, value ?? 0);
		onclose();
	}
	function applyCustom() {
		combat.setEffectDuration(iid, Math.max(0, Math.round(customValue || 0)));
		onclose();
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="dur-backdrop" onclick={onclose} onwheel={onclose}></div>
<div
	bind:this={el}
	class="dur-menu"
	role="dialog"
	aria-label="Effect duration"
	style="top:{pos.top}px; left:{pos.left}px"
>
	<div class="dur-step-row">
		<button type="button" onclick={() => combat.bumpEffectDuration(iid, -1)}>−</button>
		<button type="button" onclick={() => combat.bumpEffectDuration(iid, 1)}>＋</button>
	</div>
	{#each EFFECT_DURATION_PRESETS as p (p.label)}
		<button
			type="button"
			class="dur-item"
			class:on={rounds === p.rounds || (p.rounds === null && rounds == null)}
			onclick={() => pick(p.rounds)}>{p.label}</button
		>
	{/each}
	{#if custom}
		<div class="dur-custom">
			<input
				type="number"
				min="0"
				bind:value={customValue}
				aria-label="Custom rounds"
				onkeydown={(e) => e.key === 'Enter' && applyCustom()}
			/><span>rds</span><button type="button" onclick={applyCustom}>Set</button>
		</div>
	{:else}
		<button type="button" class="dur-item dur-custom-open" onclick={openCustom}>Custom…</button>
	{/if}
</div>

<style>
	.dur-backdrop {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: transparent;
	}
	.dur-menu {
		position: fixed;
		z-index: 61;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border-strong);
		border-radius: 9px;
		box-shadow: 0 12px 30px var(--color-overlay);
		padding: 4px;
		width: max-content;
	}
	.dur-step-row {
		display: flex;
		gap: 4px;
		padding: 2px;
		margin-bottom: 3px;
		border-bottom: 1px solid var(--color-border);
	}
	.dur-step-row button {
		flex: 1;
		font-family: var(--font-mono);
		font-size: 14px;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: 6px;
		padding: 3px 0;
		cursor: pointer;
	}
	.dur-step-row button:hover {
		border-color: var(--color-resource);
		color: var(--color-resource);
	}
	.dur-item {
		display: block;
		width: 100%;
		text-align: left;
		font-family: var(--font-mono);
		font-size: 11px;
		padding: 5px 9px;
		border-radius: 6px;
		color: var(--color-text);
		background: transparent;
		border: 0;
		cursor: pointer;
		white-space: nowrap;
	}
	.dur-item:hover {
		background: var(--color-surface);
	}
	.dur-item.on {
		color: var(--color-resource);
		background: #221c10;
	}
	.dur-custom-open {
		color: var(--color-text-muted);
	}
	.dur-custom {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 6px;
	}
	.dur-custom input {
		width: 52px;
		font-family: var(--font-mono);
		font-size: 11px;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: 6px;
		color: var(--color-text);
		padding: 4px 6px;
	}
	.dur-custom span {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--color-text-muted);
	}
	.dur-custom button {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 11px;
		color: var(--color-resource);
		background: transparent;
		border: 1px solid var(--color-border-strong);
		border-radius: 6px;
		padding: 4px 9px;
		cursor: pointer;
	}
</style>
