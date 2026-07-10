<script lang="ts">
	// Pin toggle (d-spellmgr `.ic.pin`): ★ pinned to the quick bar, ☆ not.
	let {
		on = false,
		title,
		onclick
	}: { on?: boolean; title?: string; onclick?: () => void } = $props();
</script>

<button class="icon-toggle pin" class:on type="button" {title} aria-pressed={on} {onclick}>
	{on ? '★' : '☆'}
</button>

<style>
	/* base .icon-toggle is global (components.css); the ★/☆ glyph needs a font-size and the pinned
	   state uses the crimson accent — both local to Pin */
	.icon-toggle {
		font-size: 13px;
	}
	.icon-toggle.on {
		color: var(--color-accent-bright);
		border-color: var(--color-accent-deep);
		background: var(--color-accent-soft);
	}
</style>
