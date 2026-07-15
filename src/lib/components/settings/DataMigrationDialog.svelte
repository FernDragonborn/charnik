<script lang="ts">
	// Persistent result dialog for a data-folder move. A copy/verify failure is important — the user
	// needs time to read what went wrong and the reassurance that their original data is safe — so it
	// stays on screen until dismissed (never a toast that flashes past). Uses the shared global .dialog
	// shell (styles/components.css); this only sets its width.
	let {
		tone,
		title,
		detail,
		note,
		onclose
	}: {
		/** 'error' — the move failed; 'warning' — the move succeeded but with a caveat (e.g. leftover). */
		tone: 'error' | 'warning';
		title: string;
		/** What happened, in one sentence (the fs reason / mismatch count). */
		detail: string;
		/** Reassurance line, e.g. that the original folder is untouched. */
		note?: string | undefined;
		onclose: () => void;
	} = $props();

	// This dialog MUST be acknowledged — a failed move can't be dismissed by clicking away or Escape
	// (only the Close button). Those gestures instead give a short shake to signal "you can't close it
	// like that". Toggling `shaking` off→on restarts the animation on repeated attempts.
	let shaking = $state(false);
	// Move keyboard focus INTO the dialog on open, else it stays on the button behind the backdrop.
	let closeBtn = $state<HTMLButtonElement | null>(null);
	$effect(() => closeBtn?.focus());
	function refuseClose() {
		shaking = false;
		requestAnimationFrame(() => (shaking = true));
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') refuseClose();
	}
</script>

<svelte:window on:keydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="dialog-backdrop" onclick={refuseClose}></div>
<div
	class="dialog migrate-dialog"
	class:tone-warning={tone === 'warning'}
	class:shake={shaking}
	onanimationend={() => (shaking = false)}
	role="alertdialog"
	aria-modal="true"
	aria-labelledby="mig-title"
	tabindex="-1"
>
	<header class="dialog-head">
		<span class="dialog-badge" class:err={tone === 'error'} class:warn={tone === 'warning'}
			>{tone === 'error' ? '⚠' : 'ℹ'}</span
		>
		<h2 id="mig-title" class="dialog-title">{title}</h2>
	</header>

	<div class="body">
		{#if note}<p class="note">{note}</p>{/if}
		<p class="detail">{detail}</p>
	</div>

	<footer class="dialog-foot">
		<span class="dialog-spacer"></span>
		<button class="btn primary" bind:this={closeBtn} onclick={onclose}>Close</button>
	</footer>
</div>

<style>
	.migrate-dialog {
		width: min(480px, calc(100vw - 2 * var(--space-4)));
	}
	.body {
		padding: var(--space-5) var(--space-6);
	}
	/* Reassurance sits on top (calm the user before the technical reason); the detail follows below. */
	.note {
		margin: 0 0 var(--space-3);
		font-size: var(--font-size-md);
		color: var(--color-text);
	}
	.detail {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.dialog-badge.err {
		color: var(--color-accent-bright);
	}
	.dialog-badge.warn {
		color: var(--color-resource);
	}
	/* Warning tone: recolour the head's accent stripe from crimson to the same gold as the badge. */
	.migrate-dialog.tone-warning .dialog-head {
		border-left-color: var(--color-resource);
	}

	/* Shake on a dismiss attempt. Keyframes keep the .dialog centring transform (translate(-50%,-50%))
	   and only add the horizontal wobble on top, so the panel shakes in place. */
	.migrate-dialog.shake {
		animation: dialog-shake 0.34s ease;
	}
	@keyframes dialog-shake {
		0%,
		100% {
			transform: translate(-50%, -50%);
		}
		15% {
			transform: translate(-50%, -50%) translateX(-7px);
		}
		30% {
			transform: translate(-50%, -50%) translateX(7px);
		}
		45% {
			transform: translate(-50%, -50%) translateX(-5px);
		}
		60% {
			transform: translate(-50%, -50%) translateX(5px);
		}
		75% {
			transform: translate(-50%, -50%) translateX(-3px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.migrate-dialog.shake {
			animation: none;
		}
	}
</style>
