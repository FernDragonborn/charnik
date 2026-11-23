<script lang="ts">
	// The shared dialog shell: full-screen backdrop, the centred `.dialog` panel, and its head — the
	// skeleton every question the app asks is built on (`docs/internals/ui.md` ▸ Shared controls and
	// dialogs). The head says what is happening small (`ask`), the thing the person must recognise
	// large (`title`), what it concerns under it (`sub`, a path in mono), and what follows as a
	// paragraph (`subtitle`). No badge and no accent line: a question is told by its words. Callers
	// pass their own body and footer as children, and the panel WIDTH as a prop (the one per-dialog
	// value; kept inline so the global `.dialog` shell stays width-agnostic).
	import type { Snippet } from 'svelte';
	import { dismissOnEscape } from '$lib/actions/dismissOnEscape';
	import { trapFocus } from '$lib/actions/trapFocus';
	import LangSwitcher from './LangSwitcher.svelte';

	let {
		titleId,
		title,
		ask = '',
		sub = '',
		subIsPath = false,
		subtitle = '',
		width,
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
		/** `sub` is a path: set in mono, so a folder reads as one. */
		subIsPath?: boolean;
		/** What follows from the answer, as a paragraph. */
		subtitle?: string;
		/** CSS width for the panel (e.g. "min(760px, calc(100vw - 2 * var(--space-4)))"). */
		width: string;
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
	style="width: {width}"
	role="dialog"
	aria-modal="true"
	aria-labelledby={titleId}
	tabindex="-1"
	use:dismissOnEscape={onDismiss}
	use:trapFocus
>
	<header class="dialog-head">
		<div class="dialog-lang-corner"><LangSwitcher /></div>
		{#if ask}<p class="dialog-ask">{ask}</p>{/if}
		<h2 id={titleId} class="dialog-title">{title}</h2>
		{#if sub}<p class="dialog-sub" class:is-path={subIsPath}>{sub}</p>{/if}
		{#if subtitle}<p class="dialog-subtitle">{subtitle}</p>{/if}
	</header>
	{@render children()}
</div>
