<script lang="ts">
	// Content-health diagnostics — surfaces the loader's findings to the USER (not just the dev
	// previews): malformed rows, unresolved spell_lists joins, partial translations (LOC-CHECK), plus
	// files missing metadata (source/license) or with a drifted #content-hash. Read-only; the loader
	// already computes everything (graph.issues / metaIssues / driftItems), this just presents it.
	// Two effect-token layers merge in (SPEC10): static authoring lint over every loaded row's
	// tokens, and the OPEN character's derive-time issues published by the combat page.
	import Icon from '../Icon.svelte';
	import { content } from '$lib/content/store.svelte';
	import { deriveHealth } from '$lib/character/health.svelte';
	import { lintEffectTokens } from '$lib/effects/apply';
	import { tokensOf } from '$lib/content/loader';
	import { resourceJoinIssues } from '$lib/content/resource-joins';
	import { retryPlugins } from '$lib/effects/plugin-store.svelte';
	import { app } from '$lib/stores/app.svelte';
	import { detectPlatform, Platform } from '$lib/storage/provider';
	import Switch from '$lib/components/Switch.svelte';

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
	// references to a resource pool nothing grants — an option that can never be offered, a name that
	// will never be read. Content-level (no character involved), so it sits with the loader's issues.
	// per ACTIVE EDITION, not over the union: a pool granted only in 5.5e must not silently vouch for
	// an option that only exists in 5e. Deduped by row, since a row can sit in both.
	const joinIssues = $derived.by(() => {
		if (!graph) return [];
		const seen = new Map<string, ReturnType<typeof resourceJoinIssues>[number]>();
		for (const system of app.activeEditions)
			for (const issue of resourceJoinIssues(graph, system)) seen.set(issue.file + issue.id, issue);
		return [...seen.values()];
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
			joinIssues.length +
			deriveIssues.length,
	);

	const fileLabel = (root: string, file?: string) => (file ? `${root}/${file}` : root);
	// The setting lives HERE, next to the drift list it governs — and it exists at all so the drift
	// dialog's "don't ask again" can be undone. Desktop-only: the web build cannot write content back.
	const canEditContent = detectPlatform() === Platform.Desktop;
</script>

<section class="health">
	<header class="sec-head">
		<h2>Content health</h2>
		<p class="sec-note">
			What Charnik noticed while reading your content files. The app keeps working either way — but
			anything listed here is missing from the app, or isn’t doing what its file says it should.
			Each entry names the file to open and what to change in it.
		</p>
	</header>

	{#if canEditContent}
		<div class="editing-mode">
			<Switch
				on={app.contentEditingMode}
				title="Content-editing mode"
				onclick={() => (app.contentEditingMode = !app.contentEditingMode)}
			/>
			<span class="editing-text">
				<strong>Content-editing mode</strong>
				<span class="sec-note">
					While this is on, a CSV you edit on disk has its hash re-stamped automatically and neither
					startup prompt appears. Turn it off and Charnik asks before touching a file again.
				</span>
			</span>
		</div>
	{/if}

	{#if !graph}
		<p class="muted">Loading…</p>
	{:else if total === 0}
		<div class="all-clear">
			<Icon name="check" size={13} /> All loaded content is healthy — no problems found.
		</div>
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
				<div class="group-label eyebrow {cls}">{label}</div>
				{#each rows as it, i (fileLabel(it.root, it.file) + i)}
					<div class="row {cls}">
						<div class="row-file">
							{fileLabel(it.root, it.file)}{#if it.id}<span class="row-id"> · {it.id}</span>{/if}
						</div>
						<div class="row-msg">{it.message}</div>
						{#if it.detail}<div class="row-detail">{it.detail}</div>{/if}
					</div>
				{/each}
			{/if}
		{/snippet}

		{@render issueGroup('Did not load — this content is missing from the app', errors, 'err')}
		{@render issueGroup('Loaded, but something in it is off', warnings, 'warn')}

		{#if metaIssues.length}
			<div class="group-label eyebrow meta">Files that don’t say where they came from</div>
			<p class="sec-note group-note">
				These files load and work normally — but without a source and a licence, Charnik can’t
				credit their author or tell you what you may share. It offers to fill this in when it
				starts, or you can add the two lines yourself at the top of the file.
			</p>
			{#each metaIssues as m (m.file)}
				<div class="row meta">
					<div class="row-file">{m.file}</div>
					<div class="row-detail">
						missing: {m.missingHuman.map((k) => `#content-${k}`).join(', ')}
					</div>
				</div>
			{/each}
		{/if}

		{#if driftItems.length}
			<div class="group-label eyebrow drift">Files edited outside Charnik</div>
			<p class="sec-note group-note">
				Their contents no longer match the fingerprint recorded inside them. Nothing is broken and
				your edits are being used — but until the fingerprint is re-stamped, Charnik leaves these
				files alone rather than replacing them when their content pack updates.
			</p>
			{#each driftItems as d (d.file)}
				<div class="row drift">
					<div class="row-file">{d.file}</div>
					<div class="row-detail">
						changed {d.changedAt ?? 'unknown'} · fingerprint dated {d.declaredDate ?? '—'}
					</div>
				</div>
			{/each}
		{/if}

		{#if joinIssues.length}
			<div class="group-label eyebrow warn">Points at a resource that doesn’t exist</div>
			{#each joinIssues as j (j.file + j.id)}
				<div class="row warn">
					<div class="row-file">{j.file}<span class="row-id"> · {j.id}</span></div>
					<div class="row-msg">{j.message}</div>
					<div class="row-detail">{j.detail}</div>
				</div>
			{/each}
		{/if}

		{#if tokenLints.length}
			<div class="group-label eyebrow warn">Effects that look like a slip of the pen</div>
			<p class="sec-note group-note">
				These work — Charnik is only pointing out things that are usually a typo, like a d7 or two
				branches of one formula that return different kinds of value. Written for whoever authored
				the row.
			</p>
			{#each tokenLints as l, i (l.id + i)}
				<div class="row warn">
					<div class="row-file">{l.id}</div>
					<div class="row-msg">{l.message}</div>
				</div>
			{/each}
		{/if}

		{#if deriveIssues.length}
			<div class="group-label eyebrow warn plugin-retry-row">
				<!-- not only EFFECT problems any more: a missing per-system data row (e.g. no class_casting
			     for the active edition) is reported through the same channel -->
				<span>Things that didn’t work out on “{deriveHealth.characterName}” (this sheet only)</span>
				{#if hasPluginIssue}
					<button class="retry-btn" onclick={retryPlugins}>Retry plugins</button>
				{/if}
			</div>
			{#each deriveIssues as it, i (it.token + i)}
				<div class="row warn">
					<div class="row-file">{it.source} · <span class="row-id">{it.token}</span></div>
					<div class="row-msg">{it.reason}</div>
					{#if it.detail}<div class="row-detail">{it.detail}</div>{/if}
				</div>
			{/each}
		{/if}
	{/if}
</section>

<style>
	.editing-mode {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}
	.editing-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.counts {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 18px;
	}
	.count {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
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
		font-size: var(--font-size-micro);
		margin: 18px 0 8px;
	}
	/* the "what it means / what to do" that every row in the group shares — said once above them
	   instead of repeated on forty identical rows */
	.group-note {
		margin: -4px 0 8px;
		max-width: 70ch;
	}
	.plugin-retry-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.retry-btn {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
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
		border-radius: var(--radius);
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
		font-size: var(--font-size-xs);
		color: var(--color-text);
	}
	.row-id {
		color: var(--color-text-muted);
	}
	.row-msg {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin-top: 2px;
	}
	/* the exact token/column/id, demoted under the sentence: the panel is the homebrew author's
	   debugger too, so the detail is quieter but never dropped (UX-1) */
	.row-detail {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		opacity: 0.75;
		margin-top: 4px;
	}
</style>
