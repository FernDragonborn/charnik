<script lang="ts">
	// Full-view loading screen shown while the sheet is being computed (the derive can take a beat).
	import { base } from '$app/paths';
	let { message = 'Crunching the numbers…' }: { message?: string } = $props();
</script>

<div class="loadscreen" role="status" aria-live="polite">
	<img class="loadgif" src="{base}/loading-dice.gif" alt="" width="240" height="266" />
	<p class="loadbig">{message}</p>
	<p class="loadsub">This can take up to <b>10 seconds</b> — please wait.</p>
</div>

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
	.loadsub {
		font-size: 16px;
		color: var(--color-text-muted);
		margin: 0;
	}
	.loadsub b {
		color: var(--color-accent-bright);
	}
</style>
