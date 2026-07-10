<script lang="ts">
	// Show-on-sheet toggle (d-spellmgr `.ic.eye`): open eye = on the sheet, closed = hidden.
	let {
		on = false,
		title,
		onclick
	}: { on?: boolean; title?: string; onclick?: () => void } = $props();
</script>

<button class="icon-toggle eye" class:on type="button" {title} aria-pressed={on} {onclick}>
	{#if on}
		<svg
			width="13"
			height="13"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z" />
			<circle cx="12" cy="12" r="2.5" />
		</svg>
	{:else}
		<svg
			width="13"
			height="13"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M3 13c3.5 3.5 14.5 3.5 18 0" />
			<path d="M6 16l-1 2" />
			<path d="M12 17v2.2" />
			<path d="M18 16l1 2" />
		</svg>
	{/if}
</button>

<style>
	/* base .icon-toggle is global (components.css); only the "on the sheet" green accent is local */
	.icon-toggle.on {
		color: var(--color-good);
		border-color: var(--color-good);
		background: var(--color-good-soft);
	}
</style>
