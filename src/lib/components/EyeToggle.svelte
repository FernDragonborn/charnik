<script lang="ts">
	// Show-on-sheet toggle (d-spellmgr `.ic.eye`): open eye = on the sheet, closed = hidden.
	import EyeIcon from './EyeIcon.svelte';
	let {
		on = false,
		title,
		onclick
	}: { on?: boolean; title?: string; onclick?: () => void } = $props();
</script>

<button class="icon-toggle eye" class:on type="button" {title} aria-pressed={on} {onclick}>
	<EyeIcon {on} />
</button>

<style>
	/* base .icon-toggle is global (components.css); only the "on the sheet" green accent is local */
	.icon-toggle.on {
		color: var(--color-good);
		border-color: var(--color-good);
		background: var(--color-good-soft);
	}
</style>
