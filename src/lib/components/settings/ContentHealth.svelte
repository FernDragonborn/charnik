<script lang="ts">
	// Content-health diagnostics — surfaces the loader's findings to the USER (not just the dev
	// previews): malformed rows, unresolved spell_lists joins, partial translations (LOC-CHECK), plus
	// files missing metadata (source/license) or with a drifted #content-hash. Read-only; the loader
	// already computes everything (graph.issues / metaIssues / driftItems), this just presents it.
	// Two effect-token layers merge in (SPEC10): static authoring lint over every loaded row's
	// tokens, and the OPEN character's derive-time issues published by the combat page.
	import Icon from '../Icon.svelte';
	import { _ } from '$lib/i18n';
	import { sayText } from '$lib/util/say';
	import { content } from '$lib/content/store.svelte';
	import { deriveHealth } from '$lib/character/health.svelte';
	import { lintEffectTokens } from '$lib/effects/apply';
	import { tokensOf } from '$lib/content/loader';
	import { resourceJoinIssues } from '$lib/content/resource-joins';
	import { TYPE_ASSIGNABLE_KEYS } from '$lib/content/issue-text';
	import { CONTENT_TYPES, type ContentType } from '$lib/content/schemas';
	import { assignFileType } from '$lib/content/review.svelte';
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

	// A file the loader could not place is the one problem here the user can FIX from this panel: it
	// needs a `#content-type:` line and nothing else. The picker is per file, so two unplaced files do
	// not share one choice; the write goes through the same re-stamp path as every other header fix.
	const CONTENT_TYPE_NAMES = Object.keys(CONTENT_TYPES).sort() as ContentType[];
	const isTypeAssignable = (key: string) => TYPE_ASSIGNABLE_KEYS.includes(key);
	let typeChoice = $state<Record<string, ContentType | ''>>({});
	let assigning = $state<string | null>(null);
	let assignError = $state<Record<string, string>>({});
	async function assignType(file: string) {
		const type = typeChoice[file];
		if (!type || assigning) return;
		assigning = file;
		try {
			const failures = await assignFileType(file, type);
			const failure = failures[0];
			if (failure) assignError = { ...assignError, [file]: failure.error };
		} finally {
			assigning = null;
		}
	}
	// The setting lives HERE, next to the drift list it governs — and it exists at all so the drift
	// dialog's "don't ask again" can be undone. Desktop-only: the web build cannot write content back.
	const canEditContent = detectPlatform() === Platform.Desktop;
</script>

<section class="health">
	<header class="sec-head">
		<h2>{$_('settings.health.title')}</h2>
		<p class="sec-note">{$_('settings.health.blurb')}</p>
	</header>

	{#if canEditContent}
		<div class="editing-mode">
			<Switch
				on={app.contentEditingMode}
				title={$_('settings.health.editingMode')}
				onclick={() => (app.contentEditingMode = !app.contentEditingMode)}
			/>
			<span class="editing-text">
				<strong>{$_('settings.health.editingMode')}</strong>
				<span class="sec-note">{$_('settings.health.editingModeBlurb')}</span>
			</span>
		</div>
	{/if}

	{#if !graph}
		<p class="muted">{$_('settings.health.loading')}</p>
	{:else if total === 0}
		<div class="all-clear">
			<Icon name="check" size={13} />
			{$_('settings.health.allClear')}
		</div>
	{:else}
		<div class="counts">
			<span class="count err" class:zero={errors.length === 0}
				>{$_('settings.health.countErrors', { values: { count: errors.length } })}</span
			>
			<span class="count warn" class:zero={warnings.length === 0}
				>{$_('settings.health.countWarnings', { values: { count: warnings.length } })}</span
			>
			<span class="count meta" class:zero={metaIssues.length === 0}
				>{$_('settings.health.countMeta', { values: { count: metaIssues.length } })}</span
			>
			<span class="count drift" class:zero={driftItems.length === 0}
				>{$_('settings.health.countDrift', { values: { count: driftItems.length } })}</span
			>
		</div>

		{#snippet issueGroup(label: string, rows: typeof issues, cls: string)}
			{#if rows.length}
				<div class="group-label eyebrow {cls}">{label}</div>
				{#each rows as it, i (fileLabel(it.root, it.file) + i)}
					{@const file = fileLabel(it.root, it.file)}
					<div class="row {cls}">
						<div class="row-file">
							{file}{#if it.id}<span class="row-id"> · {it.id}</span>{/if}
						</div>
						<div class="row-msg">{sayText(it, $_)}</div>
						{#if it.detail}<div class="row-detail">{it.detail}</div>{/if}
						{#if canEditContent && isTypeAssignable(it.key)}
							<div class="assign-type">
								<label class="assign-label" for="assign-{file}"
									>{$_('settings.health.assignTypeLabel')}</label
								>
								<select id="assign-{file}" bind:value={typeChoice[file]}>
									<option value="">—</option>
									{#each CONTENT_TYPE_NAMES as name (name)}
										<option value={name}
											>{$_(`contentType.${name}`, { default: name.replace(/_/g, ' ') })}</option
										>
									{/each}
								</select>
								<button
									class="retry-btn"
									disabled={!typeChoice[file] || assigning === file}
									onclick={() => assignType(file)}>{$_('settings.health.assignType')}</button
								>
							</div>
							{#if assignError[file]}<div class="row-detail">{assignError[file]}</div>{/if}
						{/if}
					</div>
				{/each}
			{/if}
		{/snippet}

		{@render issueGroup($_('settings.health.groupErrors'), errors, 'err')}
		{@render issueGroup($_('settings.health.groupWarnings'), warnings, 'warn')}

		{#if metaIssues.length}
			<div class="group-label eyebrow meta">{$_('settings.health.groupMeta')}</div>
			<p class="sec-note group-note">{$_('settings.health.groupMetaBlurb')}</p>
			{#each metaIssues as m (m.file)}
				<div class="row meta">
					<div class="row-file">{m.file}</div>
					<div class="row-detail">
						{$_('settings.health.missingDirectives', {
							values: { directives: m.missingHuman.map((k) => `#content-${k}`).join(', ') },
						})}
					</div>
				</div>
			{/each}
		{/if}

		{#if driftItems.length}
			<div class="group-label eyebrow drift">{$_('settings.health.groupDrift')}</div>
			<p class="sec-note group-note">{$_('settings.health.groupDriftBlurb')}</p>
			{#each driftItems as d (d.file)}
				<div class="row drift">
					<div class="row-file">{d.file}</div>
					<div class="row-detail">
						{$_('settings.health.driftDates', {
							values: {
								changed: d.changedAt ?? $_('settings.health.unknownDate'),
								stamped: d.declaredDate ?? '—',
							},
						})}
					</div>
				</div>
			{/each}
		{/if}

		{#if joinIssues.length}
			<div class="group-label eyebrow warn">{$_('settings.health.groupJoins')}</div>
			{#each joinIssues as j (j.file + j.id)}
				<div class="row warn">
					<div class="row-file">{j.file}<span class="row-id"> · {j.id}</span></div>
					<div class="row-msg">{sayText(j, $_)}</div>
					<div class="row-detail">{j.detail}</div>
				</div>
			{/each}
		{/if}

		{#if tokenLints.length}
			<div class="group-label eyebrow warn">{$_('settings.health.groupLints')}</div>
			<p class="sec-note group-note">{$_('settings.health.groupLintsBlurb')}</p>
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
				<span
					>{$_('settings.health.groupDerive', {
						values: { name: deriveHealth.characterName },
					})}</span
				>
				{#if hasPluginIssue}
					<button class="retry-btn" onclick={retryPlugins}
						>{$_('settings.health.retryPlugins')}</button
					>
				{/if}
			</div>
			{#each deriveIssues as it, i (it.token + i)}
				<div class="row warn">
					<div class="row-file">{it.source} · <span class="row-id">{it.token}</span></div>
					<div class="row-msg">{sayText(it, $_)}</div>
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
		gap: var(--space-2);
		margin-bottom: 18px;
	}
	.count {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		padding: var(--space-1) var(--space-2-5);
		border-radius: var(--radius-full);
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
		margin: 18px 0 var(--space-2);
	}
	/* the "what it means / what to do" that every row in the group shares — said once above them
	   instead of repeated on forty identical rows */
	.group-note {
		margin: calc(-1 * var(--space-1)) 0 var(--space-2);
		max-width: 70ch;
	}
	.plugin-retry-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}
	/* the one place this panel does something instead of reporting: the file needs a type and a type
	   is a choice from a list */
	.assign-type {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-top: var(--space-1-5);
		flex-wrap: wrap;
	}
	.assign-label {
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
	.retry-btn {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--color-text);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-full);
		padding: var(--space-1) var(--space-2-5);
		cursor: pointer;
	}
	.retry-btn:hover {
		border-color: var(--color-accent);
		color: var(--color-accent-bright);
	}
	.row {
		border: 1px solid var(--color-border);
		border-inline-start-width: 3px;
		border-radius: var(--radius);
		padding: var(--space-2) var(--space-3);
		margin-bottom: var(--space-1-5);
		background: var(--color-surface-2);
	}
	.row.err {
		border-inline-start-color: var(--color-accent);
	}
	.row.warn,
	.row.meta,
	.row.drift {
		border-inline-start-color: var(--color-warning);
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
		margin-top: var(--space-1);
	}
</style>
