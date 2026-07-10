<script lang="ts">
	// Two-dimensional source filtering (PLAN invariant): a row shows iff its FILE is enabled AND its
	// SOURCE tag is enabled. Lists every loaded source with its files + row counts; each has an
	// independent toggle. Config is persisted + live (isRowActive re-filters the compendium with no
	// reload). Disabling never drops data — re-enabling brings rows straight back.
	import { content } from '$lib/content/store.svelte';
	import { sourceLabel } from '$lib/content/detail';
	import {
		sourceConfig,
		toggleFile,
		toggleSource,
		filePath as filePathOf
	} from '$lib/content/sources.svelte';

	const graph = $derived(content.graph);

	// source → its files (path → row count), for the grouped list
	const groups = $derived.by(() => {
		const m = new Map<string, Map<string, number>>();
		for (const r of graph?.rows ?? []) {
			const files = m.get(r.source) ?? new Map<string, number>();
			const fp = filePathOf(r);
			files.set(fp, (files.get(fp) ?? 0) + 1);
			m.set(r.source, files);
		}
		return [...m.entries()]
			.map(([source, files]) => ({
				source,
				files: [...files.entries()]
					.map(([path, count]) => ({ path, count }))
					.sort((a, b) => a.path.localeCompare(b.path))
			}))
			.sort((a, b) => a.source.localeCompare(b.source));
	});

	const sourceOff = (s: string) => sourceConfig.disabledSources.includes(s);
	const fileOff = (p: string) => sourceConfig.disabledFiles.includes(p);
	const shortFile = (p: string) => p.split('/').pop() ?? p;
</script>

<section>
	<header class="sec-head">
		<h2>Content sources</h2>
		<p class="sec-note">
			Turn whole sources or individual files on and off. A row shows only when both its source and
			its file are enabled. This just hides them from browsing and creation — nothing is deleted,
			and flipping a switch back brings everything straight back.
		</p>
	</header>

	{#if !graph}
		<p class="muted">Loading…</p>
	{:else}
		{#each groups as g (g.source)}
			<div class="source" class:off={sourceOff(g.source)}>
				<div class="source-head">
					<button
						class="toggle"
						class:on={!sourceOff(g.source)}
						role="switch"
						aria-checked={!sourceOff(g.source)}
						aria-label="Toggle source {g.source}"
						onclick={() => toggleSource(g.source)}
					>
						<span class="knob"></span>
					</button>
					<span class="source-name">{sourceLabel(g.source)}</span>
					<span class="source-tag">{g.source}</span>
					<span class="source-count">{g.files.length} files</span>
				</div>
				<div class="files">
					{#each g.files as f (f.path)}
						<div class="file" class:off={fileOff(f.path) || sourceOff(g.source)}>
							<button
								class="toggle small"
								class:on={!fileOff(f.path)}
								role="switch"
								aria-checked={!fileOff(f.path)}
								aria-label="Toggle file {f.path}"
								disabled={sourceOff(g.source)}
								onclick={() => toggleFile(f.path)}
							>
								<span class="knob"></span>
							</button>
							<span class="file-name">{shortFile(f.path)}</span>
							<span class="file-count">{f.count}</span>
						</div>
					{/each}
				</div>
			</div>
		{/each}
	{/if}
</section>

<style>
	.sec-head h2 {
		font-family: var(--font-display);
		font-size: 18px;
		margin: 0 0 4px;
	}
	.sec-note {
		color: var(--color-text-muted);
		font-size: 13px;
		margin: 0 0 16px;
		max-width: 640px;
	}
	.muted {
		color: var(--color-text-muted);
		font-size: 13px;
	}
	.source {
		border: 1px solid var(--color-border);
		border-radius: 10px;
		margin-bottom: 10px;
		overflow: hidden;
	}
	.source-head {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		background: var(--color-surface-2);
	}
	.source-name {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 15px;
	}
	.source-tag {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--color-text-muted);
	}
	.source-count {
		margin-left: auto;
		font-size: 11px;
		color: var(--color-text-muted);
	}
	.source.off .source-name {
		color: var(--color-text-muted);
	}
	.files {
		padding: 6px 12px 10px 40px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.file {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 3px 0;
	}
	.file-name {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-text);
	}
	.file.off .file-name {
		color: var(--color-text-muted);
		text-decoration: line-through;
	}
	.file-count {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--color-text-muted);
	}
	/* toggle switch (mirrors the global .toggle-track pattern; local so the settings page owns sizing) */
	.toggle {
		width: 34px;
		height: 20px;
		flex: none;
		border-radius: 999px;
		border: 1px solid var(--color-border-strong);
		background: var(--color-surface);
		position: relative;
		cursor: pointer;
		padding: 0;
	}
	.toggle.small {
		width: 28px;
		height: 16px;
	}
	.toggle .knob {
		position: absolute;
		top: 1px;
		left: 1px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--color-text-muted);
		transition:
			left 0.12s,
			background 0.12s;
	}
	.toggle.small .knob {
		width: 12px;
		height: 12px;
	}
	.toggle.on {
		background: var(--color-good-soft);
		border-color: var(--color-good);
	}
	.toggle.on .knob {
		left: 15px;
		background: var(--color-good);
	}
	.toggle.small.on .knob {
		left: 13px;
	}
	.toggle:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
