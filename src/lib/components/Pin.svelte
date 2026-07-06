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
	.icon-toggle {
		width: 26px;
		height: 24px;
		display: grid;
		place-items: center;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 13px;
	}
	.icon-toggle.on {
		color: var(--color-accent-bright);
		border-color: var(--color-accent-deep);
		background: var(--color-accent-soft);
	}
</style>
