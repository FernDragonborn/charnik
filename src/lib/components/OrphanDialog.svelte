<script lang="ts">
	// Orphan-draft reassign dialog — fires when the draft cache is read and a draft's target row no longer
	// exists (deleted / renamed / source disabled). The house attention-dialog template
	// (charnik-dialog-design-template): ⚑ badge header, "N of M" step-through, two-pane body (your draft
	// prose on the left, a searchable reassign picker + live preview on the right), footer = Delete · Skip
	// · Keep-as-new · Reassign. Reassign RE-POINTS the draft (writes it under the new target); nothing is
	// written to content until the user later resumes + saves. If the chosen entry already has a draft it's
	// a CONFLICT the user resolves (which of the two survives) — both are shown so no work is lost.
	import { untrack } from 'svelte';
	import {
		repointDraft,
		deleteDraft,
		readDraft,
		type DraftEnvelope,
		type DraftTarget
	} from '$lib/drafts/store';
	import { getUserStorage } from '$lib/storage/provider';
	import type { ContentGraph, LoadedRow } from '$lib/content/loader';

	let {
		orphans,
		startAt,
		graph,
		onDone
	}: {
		orphans: DraftEnvelope[];
		/** which orphan to open first (the one whose Resolve was clicked) */
		startAt: DraftEnvelope;
		graph: ContentGraph;
		/** closed — the page reloads the drafts list. `resume` is set when a single reassign should open
		 *  its re-pointed draft straight away. */
		onDone: (resume?: DraftEnvelope) => void;
	} = $props();

	// initial-only capture is intended: the dialog opens on a fixed orphan set, `index` walks it.
	// svelte-ignore state_referenced_locally
	let index = $state(Math.max(0, orphans.indexOf(startAt)));
	const current = $derived(orphans[index]);
	const total = $derived(orphans.length);

	let query = $state('');
	let selectedRow = $state<LoadedRow | null>(null);
	// conflict state: the existing draft sitting at the chosen destination (both shown, user picks one)
	let conflict = $state<{ to: DraftTarget; existing: DraftEnvelope } | null>(null);

	// draft prose (translate data = {name,text,material,higher_level}); read-only on the left
	const draftName = $derived(String(current?.data.name ?? current?.data.name_en ?? ''));
	const draftText = $derived(String(current?.data.text ?? current?.data.text_en ?? ''));
	const oldId = $derived(current ? draftIdLabel(current.target) : '');

	function draftIdLabel(t: DraftTarget): string {
		if (t.kind === 'add') return '(new entry)';
		return `${t.type}:${t.source}:${t.id}${t.kind === 'translate' ? ` · ${t.locale}` : ''}`;
	}

	// candidates to reassign onto: same type as the orphan, across ALL sources, name-filtered
	const candidates = $derived.by(() => {
		const t = current?.target;
		if (!t || t.kind === 'add') return [];
		const q = query.trim().toLowerCase();
		const all = graph.list(t.type);
		const pool = q ? all.filter((r) => String(r.data.name_en).toLowerCase().includes(q)) : all;
		return pool.slice(0, 40);
	});

	function destTarget(row: LoadedRow): DraftTarget | null {
		const t = current?.target;
		if (!t || t.kind === 'add') return null;
		if (t.kind === 'translate')
			return {
				kind: 'translate',
				type: t.type,
				source: row.source,
				id: String(row.data.id),
				locale: t.locale
			};
		return { kind: 'editor', type: t.type, source: row.source, id: String(row.data.id) };
	}

	const preview = $derived(
		selectedRow
			? {
					title: String(selectedRow.data.name_en),
					sub: `${selectedRow.type.replace(/_/g, ' ')} · ${selectedRow.source}`,
					body: String(selectedRow.data.text_en ?? '').slice(0, 320)
				}
			: null
	);

	function advance() {
		query = '';
		selectedRow = null;
		conflict = null;
		if (index + 1 >= total) onDone();
		else index += 1;
	}

	async function reassign(resumeAfter: boolean) {
		if (!current || !selectedRow) return;
		const to = destTarget(selectedRow);
		if (!to) return;
		const storage = getUserStorage();
		const res = await repointDraft(storage, current.target, to);
		if (res === 'conflict') {
			const existing = await readDraft(storage, to);
			if (existing) {
				conflict = { to, existing };
				return;
			}
			await repointDraft(storage, current.target, to, true); // vanished meanwhile → just move
		}
		// re-pointed: build the moved envelope so a single reassign can resume straight into the editor
		const moved: DraftEnvelope = { ...current, target: to };
		if (resumeAfter && total === 1) onDone(moved);
		else advance();
	}

	// resolve the conflict: keep the incoming (orphan) draft — overwrite the destination
	async function keepIncoming() {
		if (!current || !conflict) return;
		await repointDraft(getUserStorage(), current.target, conflict.to, true);
		advance();
	}
	// keep the destination's existing draft — discard the orphan
	async function keepExisting() {
		if (!current) return;
		await deleteDraft(getUserStorage(), current.target);
		advance();
	}

	async function deleteCurrent() {
		if (!current) return;
		await deleteDraft(getUserStorage(), current.target);
		advance();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onDone();
		}
	}

	// keep index in range if the orphan set shrinks between opens
	$effect(() => {
		if (index >= total) untrack(() => onDone());
	});
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="dialog-backdrop" onclick={() => onDone()}></div>
<div class="dialog orphan-dialog" role="dialog" aria-modal="true" aria-labelledby="orphan-title">
	<header class="dialog-head">
		<span class="dialog-badge warn">⚑</span>
		<h2 id="orphan-title" class="dialog-title">
			Orphaned draft{#if total > 1}<span class="count-pill">{index + 1} of {total}</span>{/if}
		</h2>
		<p class="dialog-subtitle">
			A saved draft points at content that no longer exists (deleted, renamed, or its source is
			disabled). Reassign it to an existing entry, keep it as a new entry, or delete it.
		</p>
	</header>

	{#if conflict}
		<!-- CONFLICT: the chosen entry already has a draft — show both, user keeps one (no lost work) -->
		<div class="conflict">
			<p class="conflict-lead">
				That entry already has a draft. Keep which? Both are shown so you don't lose work.
			</p>
			<div class="cf-panes">
				<div class="cf-pane">
					<div class="cf-label">Your orphan draft</div>
					<div class="cf-name">{draftName || '(no name)'}</div>
					<div class="cf-body">{draftText}</div>
					<button class="btn primary" onclick={keepIncoming}>Keep this one</button>
				</div>
				<div class="cf-pane">
					<div class="cf-label">Existing draft at that entry</div>
					<div class="cf-name">{String(conflict.existing.data.name ?? '(no name)')}</div>
					<div class="cf-body">{String(conflict.existing.data.text ?? '')}</div>
					<button class="btn" onclick={keepExisting}>Keep the existing one</button>
				</div>
			</div>
			<button class="btn ghost cf-back" onclick={() => (conflict = null)}>← Back</button>
		</div>
	{:else}
		<div class="panes">
			<!-- LEFT: the orphan draft, read-only -->
			<div class="pane">
				<div class="panelabel">Orphaned draft · your work</div>
				<div class="d-title">{draftName || '(no name yet)'}</div>
				<div class="d-id">was: {oldId}</div>
				<div class="d-prose">{draftText}</div>
			</div>

			<!-- RIGHT: searchable reassign picker + preview -->
			<div class="pane target">
				<div class="panelabel t">Reassign to…</div>
				<input class="search" placeholder="Search entries…" bind:value={query} />
				<div class="results">
					{#each candidates as row (row.effectiveId)}
						<button
							class="res"
							class:sel={selectedRow?.effectiveId === row.effectiveId}
							onclick={() => (selectedRow = row)}
						>
							<span class="nm">{row.data.name_en}</span>
							<span class="src">{row.source}</span>
						</button>
					{:else}
						<p class="no-res">No matching entries.</p>
					{/each}
				</div>
				{#if preview}
					<div class="preview">
						<div class="pv-label">Preview · target</div>
						<div class="pv-title">{preview.title}</div>
						<div class="pv-sub">{preview.sub}</div>
						<div class="pv-body">{preview.body}…</div>
					</div>
				{/if}
			</div>
		</div>

		<footer class="dialog-foot">
			<button class="btn danger" onclick={deleteCurrent}>Delete draft</button>
			<span class="dialog-spacer"></span>
			<button class="btn ghost" onclick={advance}>Skip</button>
			<button class="btn primary" disabled={!selectedRow} onclick={() => reassign(true)}>
				{selectedRow ? `Reassign to “${selectedRow.data.name_en}”` : 'Reassign'}
			</button>
		</footer>
	{/if}
</div>

<style>
	.orphan-dialog {
		width: min(900px, calc(100vw - 2 * var(--space-4)));
	}
	.panes {
		display: grid;
		grid-template-columns: 1fr 1fr;
		min-height: 0;
		overflow: hidden;
	}
	.pane {
		padding: var(--space-4) var(--space-5);
		overflow: auto;
		min-height: 0;
	}
	.pane + .pane {
		border-left: 1px solid var(--color-border);
	}
	.panelabel {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin-bottom: 12px;
	}
	.panelabel.t {
		color: var(--color-accent-bright);
	}
	.d-title {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 22px;
	}
	.d-id {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
		margin: 3px 0 12px;
	}
	.d-prose {
		font-size: 13.5px;
		line-height: 1.55;
		color: var(--color-text);
		white-space: pre-wrap;
	}
	.search {
		width: 100%;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border-strong);
		border-radius: 8px;
		padding: 8px 11px;
		color: var(--color-text);
		font-size: 13px;
		margin-bottom: 10px;
	}
	.results {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin-bottom: 12px;
		max-height: 260px;
		overflow: auto;
	}
	.res {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 7px 10px;
		border-radius: 8px;
		cursor: pointer;
		border: 1px solid transparent;
		background: transparent;
		color: var(--color-text);
		font-size: 13px;
		text-align: left;
	}
	.res:hover {
		background: var(--color-surface-2);
	}
	.res.sel {
		background: var(--color-surface-2);
		border-color: var(--color-accent);
	}
	.res .nm {
		font-weight: 600;
	}
	.res .src {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--color-text-muted);
	}
	.no-res {
		color: var(--color-text-muted);
		font-size: 13px;
		padding: 8px 2px;
	}
	.preview {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 10px;
		padding: 12px 14px;
	}
	.pv-label {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin-bottom: 6px;
	}
	.pv-title {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 16px;
	}
	.pv-sub {
		color: var(--color-text-muted);
		font-size: 12px;
		margin: 2px 0 8px;
	}
	.pv-body {
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--color-text-muted);
		white-space: pre-wrap;
	}
	/* conflict view */
	.conflict {
		padding: var(--space-4) var(--space-5);
		overflow: auto;
	}
	.conflict-lead {
		color: var(--color-text-muted);
		font-size: 13px;
		margin: 0 0 14px;
	}
	.cf-panes {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
	}
	.cf-pane {
		border: 1px solid var(--color-border);
		border-radius: 10px;
		padding: 12px 14px;
		background: var(--color-surface-2);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.cf-label {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.cf-name {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 16px;
	}
	.cf-body {
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--color-text-muted);
		white-space: pre-wrap;
		max-height: 180px;
		overflow: auto;
	}
	.cf-back {
		margin-top: 14px;
	}
	.btn.danger {
		color: var(--color-accent-bright);
		border-color: transparent;
		background: transparent;
	}
	.btn.danger:hover {
		border-color: var(--color-accent);
	}
</style>
