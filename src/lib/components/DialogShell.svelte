<script lang="ts">
	// The shared attention-dialog shell: full-screen backdrop + the centred `.dialog` panel + the
	// badge/title/subtitle header — the skeleton every content-review modal repeated (ContentMetaModal,
	// HashDriftModal, …). Callers pass their own body + footer as children and the panel WIDTH as a prop
	// (the one per-dialog value; kept inline so the global `.dialog` shell stays width-agnostic). Uses
	// the global `.dialog*` classes (components.css) so the render is identical to the old inline shells.
	import type { Snippet } from 'svelte';
	import { dismissOnEscape } from '$lib/actions/dismissOnEscape';
	import { trapFocus } from '$lib/actions/trapFocus';
	import LangSwitcher from './LangSwitcher.svelte';

	let {
		titleId,
		title,
		subtitle,
		width,
		badge = '⚑',
		onDismiss,
		children
	}: {
		titleId: string;
		title: string;
		subtitle: string;
		/** CSS width for the panel (e.g. "min(760px, calc(100vw - 2 * var(--space-4)))"). */
		width: string;
		badge?: string;
		onDismiss: () => void;
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
		<span class="dialog-badge">{badge}</span>
		<h2 id={titleId} class="dialog-title">{title}</h2>
		<p class="dialog-subtitle">{subtitle}</p>
	</header>
	{@render children()}
</div>
