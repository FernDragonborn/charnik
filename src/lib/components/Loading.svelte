<script lang="ts">
	// Full-view loading screen shown while the sheet/content is being loaded (the derive can take a
	// beat). If `error` is set the load FAILED — show the reason instead of spinning forever, so a
	// broken content bundle on an installed app is diagnosable rather than an endless "Loading…".
	import { base } from '$app/paths';
	let {
		message = 'Crunching the numbers…',
		error = null
	}: { message?: string; error?: string | null } = $props();
</script>

{#if error}
	<div class="loadscreen" role="alert">
		<p class="loadbig err">Couldn't load content</p>
		<p class="loadsub">Something went wrong reading the content files. The error was:</p>
		<pre class="errbox">{error}</pre>
		<p class="loadsub">Please report this with the message above.</p>
	</div>
{:else}
	<div class="loadscreen" role="status" aria-live="polite">
		<img class="loadgif" src="{base}/loading-dice.gif" alt="" width="220" height="244" />
		<p class="loadbig">{message}</p>
		<p class="loadsub">This can take up to <b>10 seconds</b> — please wait.</p>
	</div>
{/if}

<style>
	.loadscreen {
		min-height: 60vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		text-align: center;
		padding: 40px 20px;
	}
	.loadgif {
		width: 240px;
		height: auto;
		border-radius: 16px;
	}
	.loadbig {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 30px;
		color: var(--color-text);
		margin: 4px 0 0;
	}
	.loadbig.err {
		color: var(--color-accent-bright);
	}
	.errbox {
		max-width: min(720px, 90vw);
		max-height: 40vh;
		overflow: auto;
		text-align: left;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-text-muted);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		padding: 12px 14px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.loadsub {
		font-size: 16px;
		color: var(--color-text-muted);
		margin: 0;
	}
	.loadsub b {
		color: var(--color-accent-bright);
	}
</style>
