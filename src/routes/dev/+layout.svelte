<script lang="ts">
	// The /dev/* pages are design previews for dialogs/flows that are hard to reach naturally
	// (first-run, data-move failures, drift…). They must NOT ship: adapter-static bundles every
	// route into the desktop app AND the public GitHub Pages demo, so this layout hides them all
	// behind the dev-server flag instead of gating each page.
	import { dev } from '$app/environment';
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

{#if dev}
	{@render children()}
{:else}
	<div class="loading">
		<p>This preview page only exists in development builds.</p>
	</div>
{/if}
