<script lang="ts">
	// Anchored dropdown for an effect's duration: a minus/plus stepper row on top, then the
	// common-duration presets and a Custom… exact-rounds input. Opens beside/below the effect's
	// remaining-rounds control, clamped to the viewport, follows that control when the page scrolls,
	// closes on a pointer outside it or on Escape (it is a dialog, and the way in is a keyboard path).
	// Writes through the combat view-model.
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import { combat } from '../combat-view-model.svelte';
	import { EFFECT_DURATION_PRESETS } from '$lib/combat/helpers';
	import { dismissOnEscape } from '$lib/actions/dismissOnEscape';

	let {
		iid,
		rounds,
		anchor,
		onclose,
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

	/** Place the menu just below the control, right-aligned to it. `clamp` pulls it left/up when it
	 *  would overflow the screen — for the OPENING placement only: while following a scroll it has to
	 *  travel with its control, not pin itself to an edge the control has already left. */
	function place(clamp: boolean): void {
		if (!el) return;
		const a = anchor.getBoundingClientRect();
		const w = el.offsetWidth;
		const h = el.offsetHeight;
		const margin = 8;
		let left = a.right - w;
		let top = a.bottom + 6;
		if (clamp) {
			if (left < margin) left = margin;
			if (top + h > window.innerHeight - margin) top = Math.max(margin, a.top - h - 6);
		}
		pos = { top, left };
	}

	// Re-placed on every scroll rather than closed by one: the menu belongs to the control it came
	// from, so it travels with it. Capture phase, because the control may sit inside a panel that
	// scrolls on its own and that scroll never reaches `window`.
	//
	// Closing is a listener too, not a full-screen catcher: a fixed catcher's scroll parent is the
	// viewport, which does not scroll in this app, so it froze the page under the open menu.
	$effect(() => {
		if (!el) return; // reading it is also what re-runs this once the element exists
		place(true);
		const follow = () => place(false);
		const reflow = () => place(true);
		const closeOnOutside = (ev: PointerEvent) => {
			const t = ev.target as Node;
			if (!el?.contains(t) && !anchor.contains(t)) onclose();
		};
		window.addEventListener('scroll', follow, true);
		window.addEventListener('resize', reflow);
		window.addEventListener('pointerdown', closeOnOutside, true);
		return () => {
			window.removeEventListener('scroll', follow, true);
			window.removeEventListener('resize', reflow);
			window.removeEventListener('pointerdown', closeOnOutside, true);
		};
	});

	function pick(value: number | null) {
		combat.effects.setEffectDuration(iid, value ?? 0);
		onclose();
	}
	function applyCustom() {
		combat.effects.setEffectDuration(iid, Math.max(0, Math.round(customValue || 0)));
		onclose();
	}
</script>

<div
	bind:this={el}
	class="dur-menu"
	role="dialog"
	aria-label={$_('combat.duration.menu')}
	style="top:{pos.top}px; left:{pos.left}px"
	use:dismissOnEscape={onclose}
>
	<div class="dur-step-row">
		<button
			type="button"
			onclick={() => combat.effects.bumpEffectDuration(iid, -1)}
			aria-label={$_('combat.duration.roundFewer')}><Icon name="minus" size={12} /></button
		>
		<button type="button" onclick={() => combat.effects.bumpEffectDuration(iid, 1)}
			><Icon name="plus" size={12} label={$_('combat.duration.roundMore')} /></button
		>
	</div>
	{#each EFFECT_DURATION_PRESETS as p (p.label)}
		<button
			type="button"
			class="dur-item"
			class:on={rounds === p.rounds || (p.rounds === null && rounds == null)}
			onclick={() => pick(p.rounds)}>{$_(p.label)}</button
		>
	{/each}
	{#if custom}
		<div class="dur-custom">
			<input
				type="number"
				min="0"
				bind:value={customValue}
				aria-label={$_('combat.duration.customRounds')}
				onkeydown={(e) => e.key === 'Enter' && applyCustom()}
			/><span>{$_('combat.menu.roundsShort')}</span><button type="button" onclick={applyCustom}
				>{$_('combat.duration.set')}</button
			>
		</div>
	{:else}
		<button type="button" class="dur-item dur-custom-open" onclick={openCustom}
			>{$_('combat.duration.custom')}</button
		>
	{/if}
</div>

<style>
	.dur-menu {
		position: fixed;
		z-index: 61;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius);
		box-shadow: 0 12px 30px var(--color-overlay);
		padding: var(--space-1);
		width: max-content;
	}
	.dur-step-row {
		display: flex;
		gap: var(--space-1);
		padding: 2px;
		margin-bottom: var(--space-1);
		border-bottom: 1px solid var(--color-border);
	}
	.dur-step-row button {
		flex: 1;
		font-family: var(--font-mono);
		font-size: var(--font-size-body);
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-1) 0;
		cursor: pointer;
	}
	.dur-step-row button:hover {
		border-color: var(--color-resource);
		color: var(--color-resource);
	}
	.dur-item {
		display: block;
		width: 100%;
		text-align: start;
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
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
		background: color-mix(in srgb, var(--color-resource) 12%, var(--color-bg));
	}
	.dur-custom-open {
		color: var(--color-text-muted);
	}
	.dur-custom {
		display: flex;
		align-items: center;
		gap: var(--space-1-5);
		padding: var(--space-1) var(--space-1-5);
	}
	.dur-custom input {
		width: 52px;
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		padding: var(--space-1) var(--space-1-5);
	}
	.dur-custom span {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
	.dur-custom button {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-xs);
		color: var(--color-resource);
		background: transparent;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		cursor: pointer;
	}
</style>
