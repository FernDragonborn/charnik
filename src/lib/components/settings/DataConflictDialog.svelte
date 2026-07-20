<script lang="ts">
	import { dismissOnEscape } from '$lib/actions/dismissOnEscape';
	// Shown when the folder chosen for a data move ISN'T empty (an automatic move needs an empty one).
	// Offers three ways out: pick another folder, just repoint (the user already copied their data
	// here), or merge the two. The table lists every file across both folders — collisions (a name in
	// both) sit up top, and the newer side is highlighted so the user can see which copy a merge keeps.
	import type { ConflictRow } from '$lib/storage/migrate';

	let {
		rows,
		currentPath,
		targetPath,
		onPickAnother,
		onRepoint,
		onMerge,
		onclose
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
	let safeBtn = $state<HTMLButtonElement | null>(null);
	$effect(() => safeBtn?.focus());
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
>
	<header class="dialog-head">
		<span class="dialog-badge warn">⚠</span>
		<h2 id="cf-title" class="dialog-title">That folder already has files</h2>
		<p class="dialog-subtitle">
			An automatic move needs an empty folder. If you've already copied your data across, choose
			<b>Only change read path</b>. To combine both folders choose <b>Merge</b> — on a name clash the
			newer file (highlighted) is kept.
		</p>
	</header>

	<div class="body">
		<div class="paths">
			<span><em>Current</em> <code title={currentPath}>{currentPath}</code></span>
			<span><em>Chosen</em> <code title={targetPath}>{targetPath}</code></span>
		</div>

		<div class="tablewrap">
			<table>
				<thead>
					<tr>
						<th>File</th>
						<th>Current folder</th>
						<th>Chosen folder</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as r (r.path)}
						<tr class:collide={r.source && r.target}>
							<td class="fname">{r.path}</td>
							<td class="when" class:newer={r.newer === 'source'} class:absent={!r.source}>
								{fmt(r.source?.mtime)}
								{#if r.newer === 'source'}<span class="tag">newer</span>{/if}
							</td>
							<td class="when" class:newer={r.newer === 'target'} class:absent={!r.target}>
								{fmt(r.target?.mtime)}
								{#if r.newer === 'target'}<span class="tag">newer</span>{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="count">
			{rows.length} file(s) · {collisions} name clash{collisions === 1 ? '' : 'es'}
		</p>
	</div>

	<footer class="dialog-foot">
		<button class="btn" bind:this={safeBtn} onclick={onPickAnother}>Choose another folder</button>
		<span class="dialog-spacer"></span>
		<button class="btn" onclick={onRepoint}>Only change read path</button>
		<button class="btn primary" onclick={onMerge}>Merge — keep newer</button>
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
		margin-right: var(--space-2);
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
		text-align: left;
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
		margin-left: var(--space-2);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-good);
		border: 1px solid var(--color-good);
		border-radius: 20px;
		padding: 0 6px;
	}
	.count {
		margin: var(--space-3) 0 0;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
</style>
