<script lang="ts">
	// Full-screen, dark-backdrop modal for the DATA-DRIFT case (DATA-VER-1): a file's body no longer
	// matches its recorded #content-hash, i.e. it was hand-edited outside the app. Offers to bump
	// #content-updated-at to today + recompute the hash. Per-file checkboxes let the user choose which
	// to update (all checked by default = "update everything"). Presentation only — the detection and
	// the atomic write-back live in the loader/provider (thin-component rule).
	import { untrack } from 'svelte';
	import { _ } from '$lib/i18n';
	import DialogShell from './DialogShell.svelte';
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

	function apply() {
		onUpdate(items.filter((i) => checked[i.file]).map((i) => i.file));
	}
</script>

<DialogShell
	titleId="drift-title"
	title={$_('contentDrift.title')}
	subtitle={$_('contentDrift.subtitle')}
	width="min(680px, calc(100vw - 2 * var(--space-4)))"
	onDismiss={onSkip}
>
	<div class="dialog-body">
		{#each items as item (item.file)}
			<label class="dialog-card file">
				<input type="checkbox" bind:checked={checked[item.file]} />
				<span class="body">
					<span class="file-name">{item.file}</span>
					<span class="dates">
						<span class="date">
							<span class="dialog-label">{$_('contentDrift.changedLabel')}</span>
							<span class="date-value strong"
								>{item.changedAt ?? $_('contentDrift.unknownDate')}</span
							>
						</span>
						<span class="date">
							<span class="dialog-label">{$_('contentDrift.declaredLabel')}</span>
							<span class="date-value">{item.declaredDate ?? $_('contentDrift.unknownDate')}</span>
						</span>
					</span>
				</span>
			</label>
		{/each}
	</div>

	<footer class="dialog-foot">
		<button class="btn ghost" onclick={onNeverAsk}>{$_('contentDrift.neverAsk')}</button>
		<span class="dialog-spacer"></span>
		<button class="btn ghost" onclick={onSkip}>{$_('contentDrift.skip')}</button>
		<button class="btn primary" onclick={apply} disabled={!anyChecked}
			>{$_('contentDrift.update')}</button
		>
	</footer>
</DialogShell>

<style>
	/* base look = global .dialog-body / .dialog-card; only the checkbox-row layout is local */
	.file {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
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
	.file-name {
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
	.date-value {
		font-size: var(--font-size-md);
		color: var(--color-text-muted);
	}
	.date-value.strong {
		color: var(--color-accent-bright);
		font-weight: 600;
	}
	/* .btn / .btn.ghost / .btn.primary (+ :disabled) are shared globals in styles/components.css */
</style>
