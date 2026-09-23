<script lang="ts">
	// A damage type's glyph. Content authors write the type free-hand ("Fire", "fire") and homebrew
	// may invent one, so an unknown type renders NOTHING rather than a placeholder — the pill next to
	// it still carries the number, and the type stays readable in the chip's tooltip.
	import { damageGlyph } from './damage-glyphs';

	let { type, size = 15 }: { type: string; size?: number } = $props();
	const paths = $derived(damageGlyph(type));
</script>

{#if paths.length}
	<svg
		class="hand-drawn"
		viewBox="0 0 24 24"
		width={size}
		height={size}
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		{#each paths as d, i (i)}<path {d} />{/each}
	</svg>
{/if}

<style>
	svg {
		flex: none;
		display: block;
		opacity: 0.8;
	}
</style>
