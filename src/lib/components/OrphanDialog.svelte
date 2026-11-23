<script lang="ts">
	// A draft whose entry is gone — deleted, renamed, or its source switched off. It is asked as one
	// of the system's questions (`docs/internals/ui.md` ▸ Shared controls and dialogs): what is
	// happening small, the draft's own name large, the draft beside the entry it may be tied to, and
	// the answers along the foot. Tying it RE-POINTS the draft; nothing is written to content until the
	// user resumes it and saves. A destination that already has a draft is a CONFLICT the user settles
	// with both drafts shown, so no work is lost either way.
	import { untrack } from 'svelte';
	import { _ } from '#lib/i18n/index.ts';
	import { app } from '#lib/stores/app.svelte.ts';
	import { asText, titleCase } from '#lib/util/format.ts';
	import { foldForSearch } from '#lib/util/search-fold.ts';
	import { submitOnEnter } from '#lib/actions/submitOnEnter.ts';
	import {
		repointDraft,
		deleteDraft,
		readDraft,
		type DraftEnvelope,
		type DraftTarget,
	} from '#lib/drafts/store.ts';
	import { byCloseness, draftFields } from '#lib/drafts/orphan-view.ts';
	import { getUserStorage } from '#lib/storage/provider.ts';
	import { type ContentGraph, type LoadedRow } from '#lib/content/loader.ts';
	import { cellText } from '#lib/content/prose.ts';
	import { localizedName, sourceLabel } from '#lib/content/detail.ts';
	import DialogShell from './DialogShell.svelte';
	import Icon from './Icon.svelte';

	let {
		orphans,
		startAt,
		graph,
		onDone,
	}: {
		orphans: DraftEnvelope[];
		/** which orphan to open first (the one whose Resolve was clicked) */
		startAt: DraftEnvelope;
		graph: ContentGraph;
		/** closed — the page reloads the drafts list. `resume` is set when a single answer should open
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
	let skipButton = $state<HTMLButtonElement | null>(null);

	const draftName = $derived(asText(current?.data.name ?? current?.data.name_en));
	const draftText = $derived(asText(current?.data.text ?? current?.data.text_en));
	const fields = $derived(current ? draftFields(current.data) : []);
	/** A row is shown in the draft's own fields, so the two read side by side. */
	const fieldLabel = (column: string): string =>
		$_(`contentField.${column}`, { default: titleCase(column) });
	const typeLabel = (type: string): string =>
		$_(`contentType.${type}`, { default: type.replace(/_/g, ' ') });

	/** What the draft was: its kind of edit, then the entry it pointed at — gone now, so said as data. */
	const kindLine = $derived.by(() => {
		const t = current?.target;
		if (!t) return '';
		const type = typeLabel(t.type);
		if (t.kind === 'add') return $_('drafts.discard.subNew', { values: { type } });
		if (t.kind === 'translate')
			return $_('drafts.discard.subTranslate', {
				values: { type, locale: t.locale.toUpperCase() },
			});
		return $_('drafts.discard.subEdit', { values: { type } });
	});
	const wasId = $derived(current && current.target.kind !== 'add' ? current.target.id : '');
	const wasLine = $derived.by(() => {
		const t = current?.target;
		if (!t || t.kind === 'add') return '';
		return `${t.type} · ${sourceLabel(t.source)} · ${t.id}`;
	});
	const savedAt = $derived(
		current
			? new Intl.DateTimeFormat(app.activeLocale, {
					day: 'numeric',
					month: 'short',
					hour: '2-digit',
					minute: '2-digit',
				}).format(new Date(current.savedAt))
			: '',
	);

	/** Only an edit of a whole row can stand as a new entry: a translation has no row of its own. */
	const canKeepAsNew = $derived(current?.target.kind === 'editor');

	// candidates to tie it to: same type as the orphan, across ALL sources; with nothing typed, the
	// ones sharing words with what the draft was editing come first
	const ranked = $derived.by(() => {
		const t = current?.target;
		if (!t || t.kind === 'add') return { rows: [], closest: null };
		const q = foldForSearch(query.trim());
		const all = graph.list(t.type);
		const pool = q ? all.filter((r) => foldForSearch(rowName(r)).includes(q)) : all;
		return byCloseness(pool, [t.id, draftName], (r) => [r.id, rowName(r)]);
	});
	const candidates = $derived(ranked.rows.slice(0, 40));
	const rowName = (row: LoadedRow): string => localizedName(row, app.activeLocale);
	/** A candidate's second line: what it is and whose, and whether it is the one most like the draft. */
	const resultLine = (row: LoadedRow): string =>
		[
			typeLabel(row.type),
			sourceLabel(row.source),
			ranked.closest === row && wasId ? $_('orphan.closest', { values: { id: wasId } }) : '',
		]
			.filter(Boolean)
			.join(' · ');

	function destTarget(row: LoadedRow): DraftTarget | null {
		const t = current?.target;
		if (!t || t.kind === 'add') return null;
		if (t.kind === 'translate')
			return {
				kind: 'translate',
				type: t.type,
				source: row.source,
				id: String(row.data.id),
				locale: t.locale,
			};
		return { kind: 'editor', type: t.type, source: row.source, id: String(row.data.id) };
	}

	/** The chosen entry's value in each of the draft's fields — what tying it there would edit. */
	const entryValue = (column: string): string =>
		selectedRow ? cellText((selectedRow.data as Record<string, unknown>)[column]).trim() : '';

	function advance() {
		query = '';
		selectedRow = null;
		conflict = null;
		if (index + 1 >= total) onDone();
		else index += 1;
	}

	/** After a draft moves: a single orphan opens straight into its editor, a queue walks on. */
	function moved(to: DraftTarget) {
		if (!current) return;
		if (total === 1) onDone({ ...current, target: to });
		else advance();
	}

	async function reassign() {
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
		moved(to);
	}

	/** A fresh add-draft holding the same row: a GUID nobody else has, so it never conflicts. */
	async function keepAsNew() {
		const t = current?.target;
		if (!t || t.kind !== 'editor') return;
		const to: DraftTarget = { kind: 'add', type: t.type, addGuid: crypto.randomUUID() };
		await repointDraft(getUserStorage(), t, to);
		moved(to);
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

	// keep index in range if the orphan set shrinks between opens
	$effect(() => {
		if (index >= total) untrack(() => onDone());
	});
</script>

<DialogShell
	titleId="orphan-title"
	ask={total > 1
		? $_('orphan.askCounted', { values: { index: index + 1, total } })
		: $_('orphan.ask')}
	title={draftName || $_('orphan.noNameYet')}
	width="min(900px, calc(100vw - 2 * var(--space-4)))"
	initialFocus={skipButton}
	onDismiss={() => onDone()}
>
	{#if conflict}
		<!-- CONFLICT: the chosen entry already has a draft — both shown, the user keeps one -->
		<div class="dialog-body">
			<p class="orphan-lead">{$_('orphan.conflictLead')}</p>
			<div class="orphan-panes">
				<section class="dialog-card orphan-pane">
					<span class="dialog-label">{$_('orphan.yours')}</span>
					<b class="orphan-name">{draftName || $_('orphan.noName')}</b>
					<div class="orphan-prose">{draftText}</div>
					<button class="btn" onclick={keepIncoming}>{$_('orphan.keepMine')}</button>
				</section>
				<section class="dialog-card orphan-pane">
					<span class="dialog-label">{$_('orphan.theirs')}</span>
					<b class="orphan-name">{asText(conflict.existing.data.name, $_('orphan.noName'))}</b>
					<div class="orphan-prose">{asText(conflict.existing.data.text)}</div>
					<button class="btn" onclick={keepExisting}>{$_('orphan.keepExisting')}</button>
				</section>
			</div>
		</div>
		<footer class="dialog-foot">
			<button class="btn" bind:this={skipButton} onclick={() => (conflict = null)}
				><Icon name="arrow-left" size={13} /> {$_('orphan.back')}</button
			>
			<span class="dialog-spacer"></span>
		</footer>
	{:else}
		<div class="dialog-body">
			<div class="orphan-panes">
				<!-- the draft, read-only -->
				<section class="dialog-card orphan-pane">
					<span class="dialog-label">{$_('orphan.paneYours')}</span>
					<div class="orphan-meta">
						<span>{kindLine}</span>
						{#if wasLine}<span>{$_('orphan.wasPrefix')} <code>{wasLine}</code></span>{/if}
						<span>{$_('orphan.lastEdited', { values: { when: savedAt } })}</span>
					</div>
					{#if fields.length}
						<dl class="orphan-fields">
							{#each fields as f (f.column)}
								<div>
									<dt>{fieldLabel(f.column)}</dt>
									<dd>{f.value}</dd>
								</div>
							{/each}
						</dl>
					{/if}
					{#if draftText}<div class="orphan-prose">{draftText}</div>{/if}
				</section>

				<!-- the entry to tie it to, and what that entry holds in the same fields -->
				{#if current?.target.kind !== 'add'}
					<section
						class="dialog-card orphan-pane"
						use:submitOnEnter={selectedRow ? () => void reassign() : undefined}
					>
						<label class="dialog-label" for="orphan-search">{$_('orphan.reassignTo')}</label>
						<input
							id="orphan-search"
							class="text-field orphan-search"
							placeholder={$_('orphan.search')}
							bind:value={query}
						/>
						<div class="orphan-results">
							{#each candidates as row (row.effectiveId)}
								<button
									class="orphan-result"
									class:is-chosen={selectedRow?.effectiveId === row.effectiveId}
									aria-pressed={selectedRow?.effectiveId === row.effectiveId}
									onclick={() => (selectedRow = row)}
								>
									<b>{rowName(row)}</b>
									<span>{resultLine(row)}</span>
								</button>
							{:else}
								<p class="orphan-none">{$_('orphan.noMatches')}</p>
							{/each}
						</div>
						{#if selectedRow}
							<div class="orphan-entry">
								<span class="dialog-label"
									>{$_('orphan.nowInEntry', { values: { name: rowName(selectedRow) } })}</span
								>
								<dl class="orphan-fields">
									{#each fields as f (f.column)}
										{@const theirs = entryValue(f.column)}
										<div>
											<dt>{fieldLabel(f.column)}</dt>
											<dd>
												{theirs || '—'}{#if theirs !== f.value}<em class="orphan-differs"
														>≠ {f.value}</em
													>{/if}
											</dd>
										</div>
									{/each}
								</dl>
							</div>
						{/if}
					</section>
				{/if}
			</div>
			<p class="orphan-lead">{$_('orphan.skipHint')}</p>
		</div>

		<footer class="dialog-foot">
			<button class="btn danger" onclick={deleteCurrent}>{$_('orphan.deleteDraft')}</button>
			<button class="btn" bind:this={skipButton} onclick={advance}>{$_('orphan.skip')}</button>
			<span class="dialog-spacer"></span>
			{#if canKeepAsNew}
				<button class="btn" onclick={keepAsNew}>{$_('orphan.keepAsNew')}</button>
			{/if}
			{#if current?.target.kind !== 'add'}
				<button class="btn primary" disabled={!selectedRow} onclick={reassign}>
					{selectedRow
						? $_('orphan.reassignNamed', { values: { name: rowName(selectedRow) } })
						: $_('orphan.reassign')}
				</button>
			{/if}
		</footer>
	{/if}
</DialogShell>

<style>
	.orphan-panes {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
		gap: var(--space-4);
	}
	.orphan-pane {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.orphan-meta {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
	}
	.orphan-meta code {
		font-family: var(--font-mono);
		color: var(--color-text);
	}
	.orphan-fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-1-5) var(--space-3);
		margin: 0;
		font-size: var(--font-size-sm);
	}
	.orphan-fields dt {
		color: var(--color-text-muted);
		font-size: var(--font-size-micro);
	}
	.orphan-fields dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.orphan-differs {
		font-style: normal;
		color: var(--color-warning);
		font-size: var(--font-size-xs);
		margin-inline-start: var(--space-1);
	}
	.orphan-prose {
		font-size: var(--font-size-sm);
		line-height: 1.55;
		white-space: pre-wrap;
		border-top: 1px solid var(--color-border);
		padding-top: var(--space-2);
		max-height: 12rem;
		overflow: auto;
	}
	.orphan-name {
		font-family: var(--font-display);
		font-size: var(--font-size-md);
	}
	.orphan-search {
		padding: var(--space-1-5) var(--space-2-5);
		font-size: var(--font-size-sm);
	}
	.orphan-results {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		max-height: 14rem;
		overflow: auto;
	}
	.orphan-result {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-1);
		padding: var(--space-1-5) var(--space-2-5);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: transparent;
		color: var(--color-text);
		font-size: var(--font-size-sm);
		text-align: start;
		cursor: pointer;
	}
	.orphan-result span {
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
	}
	.orphan-result:hover {
		background: var(--color-surface-2);
	}
	.orphan-result.is-chosen {
		border-color: var(--color-text);
	}
	.orphan-entry {
		border-top: 1px solid var(--color-border);
		padding-top: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-1-5);
	}
	.orphan-none,
	.orphan-lead {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}
</style>
