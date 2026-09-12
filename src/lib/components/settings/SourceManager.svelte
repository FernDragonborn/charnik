<script lang="ts">
	// Two-dimensional source filtering (PLAN invariant): a row shows iff its FILE is enabled AND its
	// SOURCE tag is enabled. Lists every loaded source with its files + row counts; each has an
	// independent toggle. Config is persisted + live (isRowActive re-filters the compendium with no
	// reload). Disabling never drops data — re-enabling brings rows straight back.
	import { _ } from '$lib/i18n';
	import { content } from '$lib/content/store.svelte';
	import { sourceLabel } from '$lib/content/detail';
	import Icon from '$lib/components/Icon.svelte';
	import PackUpdatesSettings from './PackUpdatesSettings.svelte';
	import {
		sourceConfig,
		setFilesEnabled,
		toggleFile,
		toggleSource,
		filePath as filePathOf,
	} from '$lib/content/sources.svelte';

	const graph = $derived(content.graph);

	// (pack, source) → its files (path → row count), for the grouped list.
	//
	// Grouped by PACK as well as source, because the source tag is self-declared: a pack writes its
	// own `#content-source`, so two packs can claim one tag and a source-only list would fold them
	// into a single row with a single switch. The pack is the folder on disk — the one thing here the
	// app knows rather than believes — so it heads the group and can be switched off on its own.
	const groups = $derived.by(() => {
		const m = new Map<
			string,
			{ key: string; pack: string; source: string; files: Map<string, number> }
		>();
		for (const r of graph?.rows ?? []) {
			const pack = r.root.slice(r.root.lastIndexOf('/') + 1);
			const key = JSON.stringify([pack, r.source]);
			const g = m.get(key) ?? { key, pack, source: r.source, files: new Map<string, number>() };
			const fp = filePathOf(r);
			g.files.set(fp, (g.files.get(fp) ?? 0) + 1);
			m.set(key, g);
		}
		return [...m.values()]
			.map((g) => ({
				...g,
				files: [...g.files.entries()]
					.map(([path, count]) => ({ path, count }))
					.sort((a, b) => a.path.localeCompare(b.path)),
			}))
			.sort((a, b) => a.pack.localeCompare(b.pack) || a.source.localeCompare(b.source));
	});

	/** A group is OFF when every file in it is off — so the group switch reads the files it governs
	 *  rather than a state of its own, and stays honest when they are toggled one by one. */
	const groupOff = (files: { path: string }[]) => files.every((f) => fileOff(f.path));

	const sourceOff = (s: string) => sourceConfig.disabledSources.includes(s);
	const fileOff = (p: string) => sourceConfig.disabledFiles.includes(p);
	const shortFile = (p: string) => p.split('/').pop() ?? p;

	// Packs start collapsed — the per-file switches are the rare case, the pack switch is the common
	// one, and a dozen packs' worth of files buries it. View state only, not persisted.
	const open = $state<Record<string, boolean>>({});
</script>

<!-- Packs come FIRST because they are the layer below: a pack is the folder the files below arrive
     in, so "what is installed" belongs above "what is shown". Splitting them into their own tab put
     four tabs on one concept. -->
<PackUpdatesSettings />

<section>
	<header class="sec-head">
		<h2>{$_('settings.sources.title')}</h2>
		<p class="sec-note">{$_('settings.sources.blurb')}</p>
	</header>

	{#if !graph}
		<p class="muted">{$_('settings.health.loading')}</p>
	{:else}
		{#each groups as g (g.key)}
			<div class="source" class:off={sourceOff(g.source) || groupOff(g.files)}>
				<div class="source-head">
					<!-- governs THIS pack's files only; the source tag next to it is what the pack calls
					     itself, and its own switch below still covers every pack that claims it -->
					<button
						class="toggle"
						class:on={!groupOff(g.files)}
						role="switch"
						aria-checked={!groupOff(g.files)}
						aria-label={$_('settings.sources.togglePack', { values: { pack: g.pack } })}
						disabled={sourceOff(g.source)}
						onclick={() =>
							setFilesEnabled(
								g.files.map((f) => f.path),
								groupOff(g.files),
							)}
					>
						<span class="knob"></span>
					</button>
					<button
						class="source-name"
						aria-expanded={open[g.key] ?? false}
						onclick={() => (open[g.key] = !open[g.key])}
						><span class="chevron"
							><Icon name={open[g.key] ? 'chevron-down' : 'chevron-right'} size={13} /></span
						>{g.pack}</button
					>
					<button
						class="source-tag as-toggle"
						title={$_('settings.sources.turnOff', { values: { source: g.source } })}
						aria-pressed={sourceOff(g.source)}
						onclick={() => toggleSource(g.source)}
					>
						{sourceLabel(g.source)}
					</button>
					<span class="source-count"
						>{$_('settings.sources.fileCount', {
							values: {
								on: g.files.filter((f) => !fileOff(f.path)).length,
								total: g.files.length,
							},
						})}</span
					>
				</div>
				{#if open[g.key]}
					<div class="files">
						{#each g.files as f (f.path)}
							<div class="file" class:off={fileOff(f.path) || sourceOff(g.source)}>
								<button
									class="toggle small"
									class:on={!fileOff(f.path)}
									role="switch"
									aria-checked={!fileOff(f.path)}
									aria-label={$_('settings.sources.toggleFile', { values: { file: f.path } })}
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
				{/if}
			</div>
		{/each}
	{/if}
</section>

<style>
	.source {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		margin-bottom: var(--space-2-5);
		overflow: hidden;
	}
	.source-head {
		display: flex;
		align-items: center;
		gap: var(--space-2-5);
		padding: var(--space-2-5) var(--space-3);
		background: var(--color-surface-2);
	}
	/* the name doubles as the expand/collapse control (same chev+label pattern as the play panels) */
	.source-name {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-body);
		color: var(--color-text);
		background: transparent;
		border: 0;
		padding: var(--space-1) var(--space-1-5) var(--space-1) var(--space-1);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.source-name:hover {
		background: var(--color-surface);
	}
	.source-tag {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
	/* the tag doubles as the SOURCE switch (the pack switch is the one on the left), so it has to
	   look pressable — an element that acts on click and says nothing about it is the affordance
	   rule's exact failure case */
	.source-tag.as-toggle {
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: transparent;
		padding: 2px var(--space-1-5);
		cursor: pointer;
	}
	.source-tag.as-toggle:hover {
		border-color: var(--color-border-strong);
		color: var(--color-text);
	}
	.source-tag.as-toggle[aria-pressed='true'] {
		text-decoration: line-through;
		opacity: 0.7;
	}
	.source-count {
		margin-inline-start: auto;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.source.off .source-name {
		color: var(--color-text-muted);
	}
	.files {
		padding: var(--space-1-5) var(--space-3) var(--space-2-5) 40px;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.file {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) 0;
	}
	.file-name {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text);
	}
	.file.off .file-name {
		color: var(--color-text-muted);
		text-decoration: line-through;
	}
	.file-count {
		margin-inline-start: auto;
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
	/* toggle switch (mirrors the global .toggle-track pattern; local so the settings page owns sizing) */
	.toggle {
		width: 34px;
		height: 20px;
		flex: none;
		border-radius: var(--radius-full);
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
		inset-inline-start: 1px;
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
		inset-inline-start: 15px;
		background: var(--color-good);
	}
	.toggle.small.on .knob {
		inset-inline-start: var(--space-3);
	}
	.toggle:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
