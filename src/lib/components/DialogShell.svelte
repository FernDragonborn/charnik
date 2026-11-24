<script lang="ts">
	// The shared dialog shell: full-screen backdrop, the centred `.dialog` panel, and its head — the
	// skeleton every question the app asks is built on (`docs/internals/ui.md` ▸ Shared controls and
	// dialogs). The head says what is happening small (`ask`), the thing the person must recognise
	// large (`title`), what it concerns under it (`sub`, a path in mono), and what follows as a
	// paragraph (`subtitle`). No badge and no accent line: a question is told by its words. Callers
	// pass their own body and footer as children, and the panel WIDTH as a prop (the one per-dialog
	// value; kept inline so the global `.dialog` shell stays width-agnostic).
	import type { Snippet } from 'svelte';
	import { dismissOnEscape } from '#lib/actions/dismissOnEscape.ts';
	import { trapFocus } from '#lib/actions/trapFocus.ts';
	import { focusHalo } from '#lib/actions/focusHalo.ts';
	import { _ } from '#lib/i18n/index.ts';
	import Icon from './Icon.svelte';
	import LangSwitcher from './LangSwitcher.svelte';

	// the key a Mac's keyboard prints is Return
	const onMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');

	let {
		titleId,
		title,
		ask = '',
		sub = '',
		subIsPath = false,
		subtitle = '',
		width,
		bottom = false,
		initialFocus,
		onDismiss,
		children,
	}: {
		titleId: string;
		/** The large line: what the person has to recognise — a character, a table, a file — or the
		 *  event itself where the event is the news. */
		title: string;
		/** The small line over it: what is happening. Empty where the title says it. */
		ask?: string;
		/** A line under the title naming what it concerns. */
		sub?: string;
		/** `sub` is a path: set smaller and lighter, so a long folder reads as one line of detail. */
		subIsPath?: boolean;
		/** What follows from the answer, as a paragraph. */
		subtitle?: string;
		/** CSS width for the panel (e.g. "min(760px, calc(100vw - 2 * var(--space-4)))"). */
		width: string;
		bottom?: boolean;
		/** Where the keyboard starts, when that is not the first control — the safe choice. */
		initialFocus?: HTMLElement | null;
		/** Omit for a dialog with NO way out but its own buttons: the backdrop stops being clickable and
		 *  Escape stops closing it (the FirstRunModal pattern). For a state the player must resolve —
		 *  being dead — a stray click must not silently dismiss the only way back. */
		onDismiss?: () => void;
		children: Snippet;
	} = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="dialog-backdrop" onclick={onDismiss}></div>
<div
	class="dialog"
	class:dialog-bottom={bottom}
	style="width: {width}"
	role="dialog"
	aria-modal="true"
	aria-labelledby={titleId}
	tabindex="-1"
	use:dismissOnEscape={onDismiss}
	use:trapFocus={initialFocus}
	use:focusHalo={{ enterKey: $_(onMac ? 'app.returnKey' : 'app.enterKey') }}
>
	<header class="dialog-head">
		<div class="dialog-lang-corner">
			{#if !bottom}
				<LangSwitcher />
			{:else if onDismiss}
				<button type="button" class="icon-button" aria-label={$_('app.close')} onclick={onDismiss}
					><Icon name="x" /></button
				>
			{/if}
		</div>
		{#if ask}<p class="dialog-ask">{ask}</p>{/if}
		<h2 id={titleId} class="dialog-title">{title}</h2>
		{#if sub}<p class="dialog-sub" class:is-path={subIsPath}>{sub}</p>{/if}
		{#if subtitle}<p class="dialog-subtitle">{subtitle}</p>{/if}
	</header>
	{@render children()}
</div>

<style>
	.dialog-bottom {
		inset: auto 0 0;
		transform: none;
		margin-inline: auto;
		max-height: calc(100dvh - var(--space-8));
		border-end-start-radius: 0;
		border-end-end-radius: 0;
	}
</style>
