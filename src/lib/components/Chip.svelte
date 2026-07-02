<script lang="ts">
	// A filter / tag chip. Color-only "on" variant, tokens-based.
	import type { Snippet } from 'svelte';
	let {
		active = false,
		onclick,
		children
	}: { active?: boolean; onclick?: () => void; children: Snippet } = $props();
</script>

<button class="chip" class:on={active} type="button" {onclick}>{@render children()}</button>

<style>
	.chip {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 11px;
		border: 1px solid var(--color-border);
		border-radius: 7px;
		padding: 3px 9px;
		color: var(--color-text-muted);
		background: transparent;
		cursor: pointer;
	}
	.chip.on {
		background: var(--color-surface-2);
		color: var(--color-text);
		border-color: var(--color-border-strong);
	}
</style>
