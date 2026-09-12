<script lang="ts">
	// Full-view loading screen shown while the sheet/content is being loaded (the derive can take a
	// beat). If `error` is set the load FAILED — show the reason instead of spinning forever, so a
	// broken content bundle on an installed app is diagnosable rather than an endless "Loading…".
	import { _ } from '$lib/i18n';
	import { base } from '$app/paths';
	// the default is a CATALOG LOOKUP, not an English sentence: the builder passes no message, so an
	// English default is the one loading screen that never translates
	let { message, error = null }: { message?: string; error?: string | null } = $props();
</script>

{#if error}
	<div class="loadscreen" role="alert">
		<p class="loadbig err">{$_('loading.failedTitle')}</p>
		<p class="loadsub">{$_('loading.failedBody')}</p>
		<pre class="errbox">{error}</pre>
		<p class="loadsub">{$_('loading.failedReport')}</p>
	</div>
{:else}
	<div class="loadscreen" role="status" aria-live="polite">
		<img class="loadgif" src="{base}/loading-dice.gif" alt="" width="220" height="244" />
		<p class="loadbig">{message ?? $_('loading.default')}</p>
		<p class="loadsub">{$_('loading.patience')}</p>
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
		border-radius: var(--radius-lg);
	}
	.loadbig {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-h2);
		color: var(--color-text);
		margin: var(--space-1) 0 0;
	}
	.loadbig.err {
		color: var(--color-accent-bright);
	}
	.errbox {
		max-width: min(720px, 90vw);
		max-height: 40vh;
		overflow: auto;
		text-align: start;
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-3) 14px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.loadsub {
		font-size: var(--font-size-md);
		color: var(--color-text-muted);
		margin: 0;
	}
</style>
