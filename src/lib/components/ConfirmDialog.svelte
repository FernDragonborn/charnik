<script lang="ts">
	// The confirm dialog: an explicit yes before something that cannot be taken back. Built on the
	// shared shell, so it says what is happening small and WHAT it happens to large.
	import DialogShell from './DialogShell.svelte';
	import { _ } from '#lib/i18n/index.ts';

	let {
		ask = '',
		title,
		message,
		confirmLabel,
		danger = false,
		onConfirm,
		onCancel,
	}: {
		/** What is about to happen, said small over the title ("Delete character"). */
		ask?: string;
		/** What it happens to — a name — or the whole question where there is no one thing. */
		title: string;
		message: string;
		/** Defaults to the shared “Confirm” — a caller names the ACTION where a verb reads better. */
		confirmLabel?: string;
		/** The yes takes something away for good: framed in crimson rather than the light answer. */
		danger?: boolean;
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();
</script>

<DialogShell
	titleId="confirm-title"
	{ask}
	{title}
	subtitle={message}
	width="min(480px, calc(100vw - 2 * var(--space-4)))"
	onDismiss={onCancel}
>
	<footer class="dialog-foot">
		<button class="btn" onclick={onCancel}>{$_('app.cancel')}</button>
		<span class="dialog-spacer"></span>
		<button class="btn" class:primary={!danger} class:danger onclick={onConfirm}
			>{confirmLabel ?? $_('app.confirm')}</button
		>
	</footer>
</DialogShell>
