<script lang="ts">
	import { _ } from '$lib/i18n';
	import Icon from '../Icon.svelte';
	import { dismissOnEscape } from '$lib/actions/dismissOnEscape';
	import { trapFocus } from '$lib/actions/trapFocus';
	// Shown when the folder chosen for a data move ISN'T empty (an automatic move needs an empty one).
	// Offers three ways out: pick another folder, just repoint (the user already copied their data
	// here), or merge the two. The table lists every file across both folders — collisions (a name in
	// both) sit up top, and the newer side is highlighted so the user can see which copy a merge keeps.
	import type { ConflictRow } from '$lib/storage/migrate';
	import LangSwitcher from '../LangSwitcher.svelte';

	let {
		rows,
		currentPath,
		targetPath,
		onPickAnother,
		onRepoint,
		onMerge,
		onclose,
	}: {
		rows: ConflictRow[];
		currentPath: string;
		targetPath: string;
		onPickAnother: () => void;
		onRepoint: () => void;
		onMerge: () => void;
		onclose: () => void;
	} = $props();

	const collisions = $derived(rows.filter((r) => r.source && r.target).length);
	const fmt = (ms?: number) => (ms == null ? '—' : new Date(ms).toLocaleString());

	// Move keyboard focus INTO the dialog on open — onto the safe choice, not the merging one.
	// Handed to `trapFocus` as its initial target (it also contains Tab + restores focus on close).
	let safeBtn = $state<HTMLButtonElement | null>(null);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="dialog-backdrop" onclick={onclose}></div>
<div
	class="dialog conflict-dialog"
	role="dialog"
	aria-modal="true"
	aria-labelledby="cf-title"
	tabindex="-1"
	use:dismissOnEscape={onclose}
	use:trapFocus={safeBtn}
>
	<header class="dialog-head">
		<div class="dialog-lang-corner"><LangSwitcher /></div>
		<span class="dialog-badge warn"><Icon name="triangle-alert" size={17} /></span>
		<h2 id="cf-title" class="dialog-title">{$_('settings.conflict.title')}</h2>
		<!-- the two choices are named as the buttons name them, so the sentence and the footer cannot
		     drift apart in any language -->
		<p class="dialog-subtitle">
			{$_('settings.conflict.blurb', {
				values: {
					repoint: $_('settings.conflict.repoint'),
					merge: $_('settings.conflict.mergeShort'),
				},
			})}
		</p>
	</header>

	<div class="body">
		<div class="paths">
			<span
				><em>{$_('settings.conflict.current')}</em>
				<code title={currentPath}>{currentPath}</code></span
			>
			<span
				><em>{$_('settings.conflict.chosen')}</em>
				<code title={targetPath}>{targetPath}</code></span
			>
		</div>

		<div class="tablewrap">
			<table>
				<thead>
					<tr>
						<th>{$_('settings.conflict.colFile')}</th>
						<th>{$_('settings.conflict.colCurrent')}</th>
						<th>{$_('settings.conflict.colChosen')}</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as r (r.path)}
						<tr class:collide={r.source && r.target}>
							<td class="fname">{r.path}</td>
							<td class="when" class:newer={r.newer === 'source'} class:absent={!r.source}>
								{fmt(r.source?.mtime)}
								{#if r.newer === 'source'}<span class="tag">{$_('settings.conflict.newer')}</span
									>{/if}
							</td>
							<td class="when" class:newer={r.newer === 'target'} class:absent={!r.target}>
								{fmt(r.target?.mtime)}
								{#if r.newer === 'target'}<span class="tag">{$_('settings.conflict.newer')}</span
									>{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="count">
			{$_('settings.conflict.counts', {
				values: { files: rows.length, clashes: collisions },
			})}
		</p>
	</div>

	<footer class="dialog-foot">
		<button class="btn" bind:this={safeBtn} onclick={onPickAnother}
			>{$_('settings.conflict.pickAnother')}</button
		>
		<span class="dialog-spacer"></span>
		<button class="btn" onclick={onRepoint}>{$_('settings.conflict.repoint')}</button>
		<button class="btn primary" onclick={onMerge}>{$_('settings.conflict.merge')}</button>
	</footer>
</div>

<style>
	.conflict-dialog {
		width: min(720px, calc(100vw - 2 * var(--space-4)));
	}
	.body {
		padding: var(--space-4) var(--space-6);
		overflow: auto;
	}
	.paths {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-5);
		margin-bottom: var(--space-3);
		font-size: var(--font-size-sm);
	}
	.paths em {
		color: var(--color-text-muted);
		font-style: normal;
		margin-inline-end: var(--space-2);
	}
	.paths code {
		font-family: var(--font-mono);
		color: var(--color-text);
	}
	.tablewrap {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--font-size-sm);
	}
	th {
		text-align: start;
		font-family: var(--font-display);
		font-weight: 600;
		color: var(--color-text-muted);
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface-2);
		border-bottom: 1px solid var(--color-border);
	}
	td {
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--color-border);
		vertical-align: top;
	}
	tbody tr:last-child td {
		border-bottom: 0;
	}
	.fname {
		font-family: var(--font-mono);
		color: var(--color-text);
		word-break: break-all;
	}
	.when {
		color: var(--color-text-muted);
		white-space: nowrap;
	}
	.when.absent {
		color: var(--color-border-strong);
	}
	/* the kept-on-merge side of a collision */
	.when.newer {
		color: var(--color-good);
	}
	.tag {
		margin-inline-start: var(--space-2);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-good);
		border: 1px solid var(--color-good);
		border-radius: var(--radius-full);
		padding: 0 var(--space-1-5);
	}
	.count {
		margin: var(--space-3) 0 0;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
</style>
