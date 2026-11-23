<script lang="ts">
	// What a number or the name in the narrow top block opens (`work/play-layout.md` ▸ NARROW-DESKTOP,
	// D5, D10, D11): a surface beside it, floated into the body so no column clips it, closed by a press
	// anywhere else or by Escape — which hands the focus back to what opened it.
	import type { Snippet } from 'svelte';
	import { anchored } from '#lib/actions/anchored.ts';
	import { floatInBody } from '#lib/actions/floatInBody.ts';
	import { dismissOnEscape } from '#lib/actions/dismissOnEscape.ts';

	let {
		anchor,
		label,
		onclose,
		children,
	}: { anchor: HTMLElement; label: string; onclose: () => void; children: Snippet } = $props();

	let box = $state<HTMLDivElement>();
	// the focus goes to the surface itself, not its first control: a value there would open its own
	// explanation over the very thing that was just asked to be read; Tab walks on from it
	$effect(() => {
		if (box && !box.contains(document.activeElement)) box.focus();
	});
	// the anchor is read BEFORE closing: once the caller has let go of what is open, the prop no
	// longer names the control the focus belongs back on
	const closeToAnchor = () => {
		const back = anchor;
		onclose();
		back.focus();
	};
</script>

<div
	bind:this={box}
	class="head-popover"
	role="dialog"
	aria-label={label}
	tabindex="-1"
	use:floatInBody
	use:anchored={{ anchor, onclose }}
	use:dismissOnEscape={closeToAnchor}
>
	{@render children()}
</div>

<style>
	.head-popover {
		position: fixed;
		z-index: 61;
		max-width: min(24rem, calc(100vw - 2 * var(--space-2)));
		padding: var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-2);
	}
</style>
