<script lang="ts">
	// The dice-roll glyph: a d20 (icosahedron, top-down) with a small d4 (tetrahedron) tucked at its
	// lower-right — a "polyhedral set", the dice-tray icon. Line art in `currentColor`; the d4 is
	// filled with the button background so it reads as a separate die overlapping the d20 cleanly.
	let { size = 18 }: { size?: number } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.4"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	<!-- d20: outer hexagon + central up-face -->
	<path d="M9 2.5 L15.5 6 L15.5 13 L9 16.5 L2.5 13 L2.5 6 Z" />
	<path d="M9 6 L12.2 11 L5.8 11 Z" />
	<!-- d4: tetrahedron, masked with the button bg so it overlaps the d20 without doubled lines -->
	<path d="M17.5 11 L23 21 L12 21 Z" fill="var(--color-accent-deep)" />
</svg>
