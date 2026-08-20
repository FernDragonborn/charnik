<script lang="ts">
	// Pin toggle: a filled star is pinned to the quick bar, an outline one is not.
	import Icon from './Icon.svelte';

	let {
		on = false,
		title,
		onclick,
	}: { on?: boolean; title?: string; onclick?: () => void } = $props();
</script>

<button class="icon-toggle pin" class:on type="button" {title} aria-pressed={on} {onclick}>
	<Icon name="star" size={13} fill={on ? 'currentColor' : 'none'} />
</button>

<style>
	/* base .icon-toggle is global (components.css); the pinned state uses the crimson accent, local
	   to Pin */
	.icon-toggle {
		font-size: var(--font-size-sm);
	}
	.icon-toggle.on {
		color: var(--color-accent-bright);
		border-color: var(--color-accent-deep);
		background: var(--color-accent-soft);
	}
</style>
