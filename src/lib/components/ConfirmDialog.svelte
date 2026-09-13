<script lang="ts">
	// Generic confirm dialog — the house attention-dialog template (charnik-dialog-design-template),
	// for a destructive/irreversible action that needs an explicit yes. Shared `.dialog` shell.
	import Icon from './Icon.svelte';
	import { _ } from '$lib/i18n';
	import { dismissOnEscape } from '$lib/actions/dismissOnEscape';
	import { trapFocus } from '$lib/actions/trapFocus';
	import LangSwitcher from './LangSwitcher.svelte';

	let {
		title,
		message,
		confirmLabel,
		danger = false,
		onConfirm,
		onCancel,
	}: {
		title: string;
		message: string;
		/** Defaults to the shared “Confirm” — a caller names the ACTION where a verb reads better. */
		confirmLabel?: string;
		/** style the confirm button as destructive. */
		danger?: boolean;
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="dialog-backdrop" onclick={onCancel}></div>
<div
	class="dialog confirm-dialog"
	role="dialog"
	aria-modal="true"
	aria-labelledby="confirm-title"
	tabindex="-1"
	use:dismissOnEscape={onCancel}
	use:trapFocus
>
	<header class="dialog-head">
		<div class="dialog-lang-corner"><LangSwitcher /></div>
		<span class="dialog-badge" class:danger><Icon name="flag" size={17} /></span>
		<h2 id="confirm-title" class="dialog-title">{title}</h2>
		<p class="dialog-subtitle">{message}</p>
	</header>
	<footer class="dialog-foot">
		<span class="dialog-spacer"></span>
		<button class="btn ghost" onclick={onCancel}>{$_('app.cancel')}</button>
		<button class="btn primary" class:danger onclick={onConfirm}
			>{confirmLabel ?? $_('app.confirm')}</button
		>
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
