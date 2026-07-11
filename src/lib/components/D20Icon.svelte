<script lang="ts">
	// A d20 (icosahedron, top-down) line glyph in `currentColor` — the dice-roll icon, replacing the
	// 🎲 emoji so it matches the app's SVG icon set (colour + crispness follow the surrounding text).
	let { size = 15 }: { size?: number } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.5"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	<!-- outer hexagon silhouette -->
	<path d="M12 2.2 L20.5 7.1 L20.5 16.9 L12 21.8 L3.5 16.9 L3.5 7.1 Z" />
	<!-- central up-facing face -->
	<path d="M12 7.4 L16.5 15.4 L7.5 15.4 Z" />
	<!-- spokes from the hexagon vertices to the central face -->
	<path
		d="M12 2.2 L12 7.4 M20.5 7.1 L16.5 15.4 M3.5 7.1 L7.5 15.4 M20.5 16.9 L16.5 15.4 M3.5 16.9 L7.5 15.4 M12 21.8 L12 15.4"
	/>
</svg>
