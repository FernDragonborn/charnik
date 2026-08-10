<script lang="ts" module>
	// The damage-type glyphs — Lucide (ISC), carried as bare path data so all thirteen types are ONE
	// component instead of thirteen files. Line art in `currentColor` and deliberately NOT colour
	// coded: the toast tints for what the DIE did (nat 20 gold, nat 1 red), and a second colour axis
	// for the damage type would fight it.
	// Lucide's `<circle>`s are written here as two-arc paths, so every glyph is a flat string[].
	const GLYPHS: Record<string, string[]> = {
		// the three physical types read as the weapon that deals them
		slashing: ['m11 19-6-6', 'm5 21-2-2', 'm8 16-4 4', 'M9.5 17.5 21 6V3h-3L6.5 14.5'],
		piercing: ['M5 19 20 4', 'M20 4 13.8 5.9', 'M20 4 18.1 10.2'],
		bludgeoning: [
			'm15 12-9.373 9.373a1 1 0 0 1-3.001-3L12 9',
			'm18 15 4-4',
			'm21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172v-.344a2 2 0 0 0-.586-1.414l-1.657-1.657A6 6 0 0 0 12.516 3H9l1.243 1.243A6 6 0 0 1 12 8.485V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5'
		],
		fire: [
			'M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4'
		],
		cold: [
			'm10 20-1.25-2.5L6 18',
			'M10 4 8.75 6.5 6 6',
			'm14 20 1.25-2.5L18 18',
			'm14 4 1.25 2.5L18 6',
			'm17 21-3-6h-4',
			'm17 3-3 6 1.5 3',
			'M2 12h6.5L10 9',
			'm20 10-1.5 2 1.5 2',
			'M22 12h-6.5L14 15',
			'm4 10 1.5 2L4 14',
			'm7 21 3-6-1.5-3',
			'm7 3 3 6h4'
		],
		lightning: [
			'M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z'
		],
		thunder: [
			'M12 20h.01',
			'M2 8.82a15 15 0 0 1 20 0',
			'M5 12.859a10 10 0 0 1 14 0',
			'M8.5 16.429a5 5 0 0 1 7 0'
		],
		acid: [
			'M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z',
			'M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97'
		],
		poison: [
			'M10 11.9a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
			'M6.7 3.4c-.9 2.5 0 5.2 2.2 6.7C6.5 9 3.7 9.6 2 11.6',
			'm8.9 10.1 1.4.8',
			'M17.3 3.4c.9 2.5 0 5.2-2.2 6.7 2.4-1.2 5.2-.6 6.9 1.5',
			'm15.1 10.1-1.4.8',
			'M16.7 20.8c-2.6-.4-4.6-2.6-4.7-5.3-.2 2.6-2.1 4.8-4.7 5.2',
			'M12 13.9v1.6',
			'M13.5 5.4c-1-.2-2-.2-3 0',
			'M17 16.4c.7-.7 1.2-1.6 1.5-2.5',
			'M5.5 13.9c.3.9.8 1.8 1.5 2.5'
		],
		necrotic: [
			'm12.5 17-.5-1-.5 1h1z',
			'M15 22a1 1 0 0 0 1-1v-1a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20v1a1 1 0 0 0 1 1z',
			'M14 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
			'M8 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0'
		],
		radiant: [
			'M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
			'M12 2v2',
			'M12 20v2',
			'm4.93 4.93 1.41 1.41',
			'm17.66 17.66 1.41 1.41',
			'M2 12h2',
			'M20 12h2',
			'm6.34 17.66-1.41 1.41',
			'm19.07 4.93-1.41 1.41'
		],
		psychic: [
			'M12 18V5',
			'M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4',
			'M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5',
			'M17.997 5.125a4 4 0 0 1 2.526 5.77',
			'M18 18a4 4 0 0 0 2-7.464',
			'M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517',
			'M6 18a4 4 0 0 1-2-7.464',
			'M6.003 5.125a4 4 0 0 0-2.526 5.77'
		],
		force: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0', 'M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0']
	};
</script>

<script lang="ts">
	// A damage type's glyph. Content authors write the type free-hand ("Fire", "fire") and homebrew
	// may invent one, so an unknown type renders NOTHING rather than a placeholder — the pill next to
	// it still carries the number, and the type stays readable in the chip's tooltip.
	let { type, size = 15 }: { type: string; size?: number } = $props();
	const paths = $derived(GLYPHS[type.trim().toLowerCase()] ?? []);
</script>

{#if paths.length}
	<svg
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
