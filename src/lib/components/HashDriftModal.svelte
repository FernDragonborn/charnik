<script lang="ts">
	// Full-screen, dark-backdrop modal for the DATA-DRIFT case (DATA-VER-1): a file's body no longer
	// matches its recorded #content-hash, i.e. it was hand-edited outside the app. Offers to bump
	// #content-updated-at to today + recompute the hash. Per-file checkboxes let the user choose which
	// to update (all checked by default = "update everything"). Presentation only — the detection and
	// the atomic write-back live in the loader/provider (thin-component rule).
	import { untrack } from 'svelte';
	import { _ } from '$lib/i18n';
	import LangSwitcher from './LangSwitcher.svelte';
	import type { DriftItem } from '$lib/content/meta';

	let {
		items,
		onUpdate,
		onSkip,
		onNeverAsk
	}: {
		items: DriftItem[];
		/** the files the user chose to bump (updated-at → today, hash → recomputed) */
		onUpdate: (files: string[]) => void;
		onSkip: () => void;
		onNeverAsk: () => void;
	} = $props();

	// which files are checked for updating — all on by default (snapshot at open)
	const checked = $state<Record<string, boolean>>(
		untrack(() => Object.fromEntries(items.map((i) => [i.file, true])))
	);
	const anyChecked = $derived(items.some((i) => checked[i.file]));

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onSkip();
		}
	}
	function apply() {
		onUpdate(items.filter((i) => checked[i.file]).map((i) => i.file));
	}
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onSkip}></div>
<div class="modal" role="dialog" aria-modal="true" aria-labelledby="drift-title" tabindex="-1">
	<header class="head">
		<div class="lang-corner"><LangSwitcher /></div>
		<span class="badge">⚑</span>
		<h2 id="drift-title" class="title">{$_('contentDrift.title')}</h2>
		<p class="subtitle">{$_('contentDrift.subtitle')}</p>
	</header>

	<div class="files">
		{#each items as item (item.file)}
			<label class="file">
				<input type="checkbox" bind:checked={checked[item.file]} />
				<span class="body">
					<span class="fname">{item.file}</span>
					<span class="dates">
						<span class="date">
							<span class="dlabel">{$_('contentDrift.changedLabel')}</span>
							<span class="dval strong">{item.changedAt ?? $_('contentDrift.unknownDate')}</span>
						</span>
						<span class="date">
							<span class="dlabel">{$_('contentDrift.declaredLabel')}</span>
							<span class="dval">{item.declaredDate ?? $_('contentDrift.unknownDate')}</span>
						</span>
					</span>
				</span>
			</label>
		{/each}
	</div>

	<footer class="foot">
		<button class="btn ghost" onclick={onNeverAsk}>{$_('contentDrift.neverAsk')}</button>
		<span class="spacer"></span>
		<button class="btn ghost" onclick={onSkip}>{$_('contentDrift.skip')}</button>
		<button class="btn primary" onclick={apply} disabled={!anyChecked}
			>{$_('contentDrift.update')}</button
		>
	</footer>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: var(--color-overlay);
		z-index: 60;
	}
	.modal {
		position: fixed;
		inset: 0;
		z-index: 61;
		width: min(680px, calc(100vw - 2 * var(--space-4)));
		max-height: calc(100vh - 2 * var(--space-6));
		margin: auto;
		display: flex;
		flex-direction: column;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-2);
		overflow: hidden;
	}
	.head {
		position: relative;
		padding: var(--space-5) var(--space-6) var(--space-4);
		border-bottom: 1px solid var(--color-border);
		border-left: 4px solid var(--color-accent);
	}
	.lang-corner {
		position: absolute;
		top: var(--space-4);
		right: var(--space-4);
	}
	.badge {
		display: inline-block;
		color: var(--color-accent-bright);
		font-size: var(--font-size-lg);
	}
	.title {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-xl);
		color: var(--color-text);
		margin: var(--space-1) 0 var(--space-2);
	}
	.subtitle {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		line-height: var(--line-height);
	}
	.files {
		overflow: auto;
		padding: var(--space-4) var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.file {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-4);
		cursor: pointer;
	}
	.file input {
		margin-top: 3px;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		flex: 1;
	}
	.fname {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		color: var(--color-text);
	}
	.dates {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-6);
	}
	.date {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.dlabel {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.dval {
		font-size: var(--font-size-md);
		color: var(--color-text-muted);
	}
	.dval.strong {
		color: var(--color-accent-bright);
		font-weight: 600;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-4) var(--space-6);
		border-top: 1px solid var(--color-border);
	}
	.spacer {
		flex: 1;
	}
	/* .btn / .btn.ghost / .btn.primary (+ :disabled) are shared globals in styles/components.css */
</style>
