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
			<div class="lang-corner"><LangSwitcher /></div>
			<h2 id="mw-title">{$_('mobile.title')}</h2>
			<p id="mw-body">{$_('mobile.body')}</p>
			<button type="button" class="continue" onclick={dismiss}>{$_('mobile.continue')}</button>
		</div>
	</div>
{/if}

<style>
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
		/* Size to the content (the body's 60ch measure sets the natural width), never wider than the
		   viewport. On a phone the text wraps to the available width so the card is near-full; on a
		   wider screen it stays a content-sized, centred card instead of stretching edge to edge. */
		width: fit-content;
		max-width: 100%;
		/* Never taller than the viewport — its own content scrolls if it must, so the button stays
		   reachable on the shortest screens. */
		max-height: 100%;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		/* Small horizontal padding — the banner is for small screens, so give the (larger) text the
		   width and don't waste it on side gutters. */
		padding: var(--space-5) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
		box-shadow: var(--shadow-2);
		/* Wrap word-by-word; only break a word mid-way if it alone can't fit the line (never splits
		   ordinary words like "функціоналу"). */
		overflow-wrap: break-word;
	}
	.lang-corner {
		position: absolute;
		top: var(--space-3);
		inset-inline-end: var(--space-3);
	}
	h2 {
		margin: 0;
		/* Keep the title clear of the language switcher in the corner. */
		padding-inline-end: var(--space-7, var(--space-6));
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
		color: var(--color-text);
		/* Cap the measure at 60 characters — comfortable reading length; on wider cards lines stop
		   there instead of running the full width. */
		max-width: 60ch;
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
