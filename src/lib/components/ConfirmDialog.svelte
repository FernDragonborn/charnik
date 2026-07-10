<script lang="ts">
	// Generic confirm dialog — the house attention-dialog template (charnik-dialog-design-template),
	// for a destructive/irreversible action that needs an explicit yes. Shared `.dialog` shell.
	let {
		title,
		message,
		confirmLabel = 'Confirm',
		danger = false,
		onConfirm,
		onCancel
	}: {
		title: string;
		message: string;
		confirmLabel?: string;
		/** style the confirm button as destructive. */
		danger?: boolean;
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onCancel();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="dialog-backdrop" onclick={onCancel}></div>
<div class="dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
	<header class="dialog-head">
		<span class="dialog-badge" class:danger>⚑</span>
		<h2 id="confirm-title" class="dialog-title">{title}</h2>
		<p class="dialog-subtitle">{message}</p>
	</header>
	<footer class="dialog-foot">
		<span class="dialog-spacer"></span>
		<button class="btn ghost" onclick={onCancel}>Cancel</button>
		<button class="btn primary" class:danger onclick={onConfirm}>{confirmLabel}</button>
	</footer>
</div>

<style>
	.confirm-dialog {
		width: min(440px, calc(100vw - 2 * var(--space-4)));
	}
	.dialog-badge.danger {
		color: var(--color-accent-bright);
	}
	.btn.primary.danger {
		background: var(--color-accent);
		border-color: var(--color-accent);
	}
</style>
