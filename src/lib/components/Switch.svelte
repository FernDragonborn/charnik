<script lang="ts">
	import { provenance } from '#lib/actions/provenance.ts';
	// Toggle switch (d-spellmgr `.tg`). `lock` = always-on/disabled (e.g. always-prepared).
	let {
		on = false,
		lock = false,
		title,
		onclick,
	}: { on?: boolean; lock?: boolean; title?: string; onclick?: () => void } = $props();
</script>

<button
	class="toggle-track"
	class:on
	class:lock
	type="button"
	use:provenance={title}
	aria-label={title}
	aria-disabled={lock || undefined}
	aria-pressed={on}
	onclick={lock ? undefined : onclick}
></button>

<style>
	.toggle-track.lock {
		opacity: 0.45;
		cursor: default;
	}
</style>
