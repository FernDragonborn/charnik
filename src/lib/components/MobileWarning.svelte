<script lang="ts">
	import { onMount } from 'svelte';
	import { _ } from '$lib/i18n';
	import LangSwitcher from './LangSwitcher.svelte';

	// The layout has NO responsive/mobile styling yet (docs/PLAN.md — mobile comes after the core).
	// A narrow viewport is the honest signal that the layout is broken here — not user-agent, which
	// lies. Threshold picked empirically. Dismiss is in-memory only: this component lives in the root
	// layout (never remounted across SPA navigation), so a dismissal lasts the whole visit but a real
	// page reload shows the warning again — the point is that every fresh visit gets the heads-up.
	const QUERY = '(max-width: 800px)';

	let narrow = $state(false);
	let dismissed = $state(false);
	let shaking = $state(false);

	onMount(() => {
		const mq = window.matchMedia(QUERY);
		narrow = mq.matches;
		const onChange = () => (narrow = mq.matches);
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	});

	// While the warning is up, hide the non-responsive chrome (topbar/main). It overflows horizontally on
	// a phone, which expands the LAYOUT viewport past the screen and pushes a `position: fixed` overlay
	// off-side. Removing that overflow collapses the layout viewport to device width, so `inset: 0` tracks
	// the visible screen — and it stays pure CSS, so it re-fits live as the viewport resizes. The class
	// goes on <html> (see the :global rules below); the reactive statement keeps it in sync.
	$effect(() => {
		document.documentElement.classList.toggle('mobile-blocked', narrow && !dismissed);
	});

	function dismiss() {
		dismissed = true;
	}

	// Clicking the backdrop can't dismiss this warning (that's the point — people must read it and use
	// the button). Instead the card shakes to say "not that way". `e.target === e.currentTarget` keeps a
	// click inside the card from triggering it.
	function onBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) shaking = true;
	}
</script>

{#if narrow && !dismissed}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="mobile-warning" onclick={onBackdropClick}>
		<div
			class="card"
			class:shake={shaking}
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="mw-title"
			aria-describedby="mw-body"
			tabindex="-1"
			onanimationend={() => (shaking = false)}
		>
			<div class="dialog-lang-corner"><LangSwitcher /></div>
			<h2 id="mw-title">{$_('mobile.title')}</h2>
			<p id="mw-body">{$_('mobile.body')}</p>
			<button type="button" class="continue" onclick={dismiss}>{$_('mobile.continue')}</button>
		</div>
	</div>
{/if}

<style>
	/* Hide the non-responsive chrome while the warning is up, so the layout viewport collapses to device
	   width and the fixed overlay below covers exactly the visible screen (see the script comment). */
	:global(html.mobile-blocked .topbar),
	:global(html.mobile-blocked main) {
		display: none;
	}
	.mobile-warning {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		/* Scroll the overlay, not just the card: on a short screen (landscape phone) a tall card would
		   otherwise clip at the top with no way to reach it. Small FIXED gutter — the banner exists FOR
		   small screens, so the card must take the width, not shrink with it. */
		overflow: auto;
		padding: var(--space-3);
		background: color-mix(in srgb, var(--color-bg) 92%, transparent);
		backdrop-filter: blur(2px);
	}
	.card {
		position: relative;
		/* One fixed measure (~30 chars), never wider than the viewport. Both the title and the body wrap
		   to THIS width — so a long title (e.g. the Ukrainian one) wraps onto a new line instead of
		   stretching the card and leaving the shorter body with dead space on the right. */
		width: min(100%, 22rem);
		/* Never taller than the viewport — its own content scrolls if it must, so the button stays
		   reachable on the shortest screens. */
		max-height: 100%;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-6) var(--space-5);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
		box-shadow: var(--shadow-2);
		/* Wrap word-by-word; only break a word mid-way if it alone can't fit the line (never splits
		   ordinary words like "функціоналу"). */
		overflow-wrap: break-word;
	}
	h2 {
		margin: 0;
		/* Keep the title clear of the language switcher in the corner: its offset (--space-4) plus room
		   for the chip itself, so a full-width title wraps before it instead of sliding under it. */
		padding-inline-end: calc(var(--space-4) + var(--space-8));
		font-family: var(--font-display);
		/* Big and fixed — readability first on the small screens this banner is FOR (28px). */
		font-size: var(--font-size-xl);
		color: var(--color-accent);
	}
	p {
		margin: 0;
		/* Larger body too (20px), so the warning is easy to read on a phone. */
		font-size: var(--font-size-lg);
		line-height: 1.5;
		/* Honour the \n\n between sentences in the message (one line per sentence) while still wrapping. */
		white-space: pre-line;
		color: var(--color-text);
	}
	.continue {
		align-self: flex-start;
		cursor: pointer;
		padding: var(--space-2) var(--space-4);
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}
	.continue:hover {
		color: var(--color-text);
		background: var(--color-surface-2);
	}
	.card.shake {
		animation: mw-shake 0.4s;
	}
	@keyframes mw-shake {
		10%,
		90% {
			transform: translateX(-2px);
		}
		20%,
		80% {
			transform: translateX(4px);
		}
		30%,
		50%,
		70% {
			transform: translateX(-8px);
		}
		40%,
		60% {
			transform: translateX(8px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.card.shake {
			animation: none;
		}
	}
</style>
