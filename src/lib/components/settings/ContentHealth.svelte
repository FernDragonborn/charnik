<script lang="ts">
	// Content-health diagnostics — surfaces the loader's findings to the USER (not just the dev
	// previews): malformed rows, unresolved spell_lists joins, partial translations (LOC-CHECK), plus
	// files missing metadata (source/license) or with a drifted #content-hash. Read-only; the loader
	// already computes everything (graph.issues / metaIssues / driftItems), this just presents it.
	// Two effect-token layers merge in (SPEC10): static authoring lint over every loaded row's
	// tokens, and the OPEN character's derive-time issues published by the combat page.
	import { content } from '$lib/content/store.svelte';
	import { deriveHealth } from '$lib/character/health.svelte';
	import { lintEffectTokens } from '$lib/effects/apply';
	import { tokensOf } from '$lib/content/loader';
	import { retryPlugins } from '$lib/effects/plugin-store.svelte';

	const graph = $derived(content.graph);
	const issues = $derived(graph?.issues ?? []);
	const errors = $derived(issues.filter((i) => i.level === 'error'));
	const warnings = $derived(issues.filter((i) => i.level === 'warn'));
	const metaIssues = $derived(graph?.metaIssues ?? []);
	const driftItems = $derived(graph?.driftItems ?? []);
	// authoring-slip warnings in effect tokens (mixed-type if(), unusual die) — spec-promised soft
	// warns, computed once per graph load (parses are memoized)
	const tokenLints = $derived.by(() => {
		if (!graph) return [];
		const out: { id: string; message: string }[] = [];
		for (const row of graph.rows)
			for (const w of lintEffectTokens(tokensOf(row))) out.push({ id: row.id, message: w });
		return out;
	});
	const deriveIssues = $derived(deriveHealth.issues);
	// a plugin token that degraded (broken/over-budget/auto-disabled) — offer a one-click retry that
	// resets the per-character fail counters and re-derives (e.g. after fixing the plugin's code)
	const hasPluginIssue = $derived(deriveIssues.some((i) => i.token.startsWith('plugin:')));
	const total = $derived(
		errors.length +
			warnings.length +
			metaIssues.length +
			driftItems.length +
			tokenLints.length +
			deriveIssues.length
	);

	const fileLabel = (root: string, file?: string) => (file ? `${root}/${file}` : root);
</script>

<section class="health">
	<header class="sec-head">
		<h2>Content health</h2>
		<p class="sec-note">
			Problems found while loading your content — nothing here blocks the app, but each is worth
			fixing so entries display and merge correctly.
		</p>
	</header>

	{#if !graph}
		<p class="muted">Loading…</p>
	{:else if total === 0}
		<div class="all-clear">✓ All loaded content is healthy — no problems found.</div>
	{:else}
		<div class="counts">
			<span class="count err" class:zero={errors.length === 0}>{errors.length} errors</span>
			<span class="count warn" class:zero={warnings.length === 0}>{warnings.length} warnings</span>
			<span class="count meta" class:zero={metaIssues.length === 0}
				>{metaIssues.length} missing metadata</span
			>
			<span class="count drift" class:zero={driftItems.length === 0}
				>{driftItems.length} edited outside the app</span
			>
		</div>

		{#snippet issueGroup(label: string, rows: typeof issues, cls: string)}
			{#if rows.length}
				<div class="group-label {cls}">{label}</div>
				{#each rows as it, i (fileLabel(it.root, it.file) + i)}
					<div class="row {cls}">
						<div class="row-file">
							{fileLabel(it.root, it.file)}{#if it.id}<span class="row-id"> · {it.id}</span>{/if}
						</div>
						<div class="row-msg">{it.message}</div>
					</div>
				{/each}
			{/if}
		{/snippet}

		{@render issueGroup('Errors — these rows are dropped', errors, 'err')}
		{@render issueGroup('Warnings', warnings, 'warn')}

		{#if metaIssues.length}
			<div class="group-label meta">Missing metadata (source / license)</div>
			{#each metaIssues as m (m.file)}
				<div class="row meta">
					<div class="row-file">{m.file}</div>
					<div class="row-msg">needs: {m.missingHuman.join(', ')}</div>
				</div>
			{/each}
		{/if}

		{#if driftItems.length}
			<div class="group-label drift">Edited outside the app (hash no longer matches)</div>
			{#each driftItems as d (d.file)}
				<div class="row drift">
					<div class="row-file">{d.file}</div>
					<div class="row-msg">
						changed {d.changedAt ?? 'unknown'} · declared {d.declaredDate ?? '—'}
					</div>
				</div>
			{/each}
		{/if}

		{#if tokenLints.length}
			<div class="group-label warn">Effect-token warnings (authoring)</div>
			{#each tokenLints as l, i (l.id + i)}
				<div class="row warn">
					<div class="row-file">{l.id}</div>
					<div class="row-msg">{l.message}</div>
				</div>
			{/each}
		{/if}

		{#if deriveIssues.length}
			<div class="group-label warn plugin-retry-row">
				<span>Effect problems for “{deriveHealth.characterName}” (this character only)</span>
				{#if hasPluginIssue}
					<button class="retry-btn" onclick={retryPlugins}>Retry plugins</button>
				{/if}
			</div>
			{#each deriveIssues as it, i (it.token + i)}
				<div class="row warn">
					<div class="row-file">{it.source} · <span class="row-id">{it.token}</span></div>
					<div class="row-msg">{it.reason}</div>
				</div>
			{/each}
		{/if}
	{/if}
</section>

<style>
	.counts {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 18px;
	}
	.count {
		font-family: var(--font-mono);
		font-size: 11px;
		padding: 3px 10px;
		border-radius: 20px;
		border: 1px solid var(--color-border-strong);
		color: var(--color-text);
	}
	.count.zero {
		color: var(--color-text-muted);
		opacity: 0.55;
	}
	.count.err:not(.zero) {
		color: var(--color-accent-bright);
		border-color: var(--color-accent);
	}
	.count.warn:not(.zero),
	.count.meta:not(.zero),
	.count.drift:not(.zero) {
		color: var(--color-warning);
		border-color: var(--color-warning);
	}
	.group-label {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin: 18px 0 8px;
	}
	.plugin-retry-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.retry-btn {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--color-text);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border-strong);
		border-radius: 20px;
		padding: 3px 10px;
		cursor: pointer;
	}
	.retry-btn:hover {
		border-color: var(--color-accent);
		color: var(--color-accent-bright);
	}
	.row {
		border: 1px solid var(--color-border);
		border-left-width: 3px;
		border-radius: 8px;
		padding: 8px 12px;
		margin-bottom: 6px;
		background: var(--color-surface-2);
	}
	.row.err {
		border-left-color: var(--color-accent);
	}
	.row.warn,
	.row.meta,
	.row.drift {
		border-left-color: var(--color-warning);
	}
	.row-file {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-text);
	}
	.row-id {
		color: var(--color-text-muted);
	}
	.row-msg {
		font-size: 13px;
		color: var(--color-text-muted);
		margin-top: 2px;
	}
</style>
