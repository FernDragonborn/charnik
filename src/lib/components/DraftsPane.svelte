<script lang="ts">
	// Pending-drafts list — the full-width pane that replaces the editing block in the compendium right
	// column (opened from the "✎ Edit compendium" → Drafts entry). Lists EVERY unsaved draft (translate /
	// add / editor), grouped, each resumable or deletable. Orphans (a draft whose target row is gone) sit
	// up top with a Resolve action that opens the reassign dialog. Presentation + local list state only;
	// the draft IO lives in $lib/drafts/store (thin-component rule).
	import { onMount } from 'svelte';
	import { getUserStorage } from '$lib/storage/provider';
	import { listDrafts, deleteDraft, draftEffectiveId, type DraftEnvelope } from '$lib/drafts/store';
	import type { ContentGraph } from '$lib/content/loader';

	let {
		graph,
		onResume,
		onResolveOrphans
	}: {
		graph: ContentGraph;
		/** Resume a draft — the page routes it (translate → /translate preselected; add → the edit form). */
		onResume: (env: DraftEnvelope) => void;
		/** Open the reassign dialog for the orphan set, starting at the clicked one. */
		onResolveOrphans: (orphans: DraftEnvelope[], startAt: DraftEnvelope) => void;
	} = $props();

	// one view-row per draft; recomputed whenever the underlying list reloads
	interface DraftRow {
		env: DraftEnvelope;
		kind: 'translate' | 'add' | 'editor';
		icon: string;
		title: string;
		fragment: string;
		typeLabel: string;
		isOrphan: boolean;
		age: string;
	}

	let drafts = $state<DraftEnvelope[]>([]);
	let loading = $state(true);

	async function reload() {
		loading = true;
		drafts = (await listDrafts(getUserStorage())).sort((a, b) =>
			b.savedAt.localeCompare(a.savedAt)
		);
		loading = false;
	}
	onMount(reload);

	const ICON = { translate: '⇄', add: '＋', editor: '✎' } as const;

	function ago(iso: string): string {
		const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
		if (min < 1) return 'just now';
		if (min < 60) return `${min} min ago`;
		const hr = Math.floor(min / 60);
		if (hr < 24) return `${hr} h ago`;
		return `${Math.floor(hr / 24)} d ago`;
	}

	function toRow(env: DraftEnvelope): DraftRow {
		const t = env.target;
		const typeLabel = t.type.replace(/_/g, ' ');
		if (t.kind === 'add') {
			const name = String(env.data.name_en ?? '').trim();
			return {
				env,
				kind: 'add',
				icon: ICON.add,
				title: name || 'Untitled',
				fragment: name ? `· new ${typeLabel}` : `· unsaved new ${typeLabel}`,
				typeLabel,
				isOrphan: false,
				age: ago(env.savedAt)
			};
		}
		const eid = draftEffectiveId(t);
		const row = eid ? graph.get(eid) : undefined;
		const rowName = row ? String(row.data.name_en) : t.id;
		return {
			env,
			kind: t.kind,
			icon: ICON[t.kind],
			title: rowName,
			fragment: t.kind === 'translate' ? `→ ${t.locale.toUpperCase()}` : '· edit all fields',
			typeLabel,
			isOrphan: !row,
			age: ago(env.savedAt)
		};
	}

	const rows = $derived(drafts.map(toRow));
	const orphanRows = $derived(rows.filter((r) => r.isOrphan));
	const translateRows = $derived(rows.filter((r) => !r.isOrphan && r.kind === 'translate'));
	const addRows = $derived(rows.filter((r) => r.kind === 'add'));
	const editorRows = $derived(rows.filter((r) => !r.isOrphan && r.kind === 'editor'));
	const orphanEnvs = $derived(orphanRows.map((r) => r.env));

	async function remove(env: DraftEnvelope) {
		await deleteDraft(getUserStorage(), env.target);
		await reload();
	}
</script>

<div class="drafts-pane">
	<div class="dp-head">
		<h2 class="dp-title">Drafts</h2>
		<span class="dp-sub">
			{#if loading}loading…{:else}{drafts.length} unfinished · autosaved locally{/if}
		</span>
	</div>
	<p class="dp-hint">Resume picks up exactly where you left off. Deleting a draft is permanent.</p>

	{#if !loading && drafts.length === 0}
		<p class="dp-empty">No drafts. Unsaved translations and new entries show up here.</p>
	{/if}

	{#snippet group(label: string, items: DraftRow[], resolvable: boolean)}
		{#if items.length}
			<div class="dp-group-label">{label}</div>
			{#each items as r (r.env.target)}
				<div class="draft" class:is-orphan={r.isOrphan}>
					<div class="dkind {r.kind}">{r.icon}</div>
					<div class="dmeta">
						<div class="dtitle">{r.title} <span class="frag">{r.fragment}</span></div>
						<div class="dsub">
							{#if r.isOrphan}
								<span class="tag orphan">orphan</span>
								<span>target entry not found (deleted or source disabled)</span>
							{:else}
								<span class="tag {r.kind}">{r.kind}</span>
								<span>{r.typeLabel}</span>
							{/if}
							<span>· {r.age}</span>
						</div>
					</div>
					<div class="dactions">
						{#if resolvable}
							<button class="btn warn" onclick={() => onResolveOrphans(orphanEnvs, r.env)}>
								Resolve…
							</button>
						{:else}
							<button class="btn primary" onclick={() => onResume(r.env)}>Resume</button>
						{/if}
						<button class="btn danger" onclick={() => remove(r.env)}>Delete</button>
					</div>
				</div>
			{/each}
		{/if}
	{/snippet}

	{@render group('⚑ Needs attention', orphanRows, true)}
	{@render group('Translations', translateRows, false)}
	{@render group('New entries', addRows, false)}
	{@render group('Editor', editorRows, false)}
</div>

<style>
	.drafts-pane {
		padding: 4px 4px 24px;
		max-width: 720px;
	}
	.dp-head {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}
	.dp-title {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 22px;
		margin: 0;
	}
	.dp-sub {
		color: var(--color-text-muted);
		font-size: 12px;
	}
	.dp-hint {
		color: var(--color-text-muted);
		font-size: 12px;
		margin: 4px 0 18px;
	}
	.dp-empty {
		color: var(--color-text-muted);
		font-size: 13px;
		padding: 20px 0;
	}
	.dp-group-label {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin: 18px 0 8px;
	}
	.draft {
		display: flex;
		align-items: center;
		gap: 12px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 10px;
		padding: 11px 13px;
		margin-bottom: 8px;
	}
	.draft:hover {
		border-color: var(--color-border-strong);
	}
	.draft.is-orphan {
		border-color: var(--color-warning);
	}
	.dkind {
		width: 34px;
		height: 34px;
		flex: none;
		border-radius: 8px;
		display: grid;
		place-items: center;
		font-size: 15px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
	}
	.dkind.translate {
		color: var(--color-good);
	}
	.dkind.add {
		color: var(--color-resource);
	}
	.dkind.editor {
		color: var(--color-accent-bright);
	}
	.dmeta {
		flex: 1;
		min-width: 0;
	}
	.dtitle {
		font-size: 14px;
		font-weight: 600;
		color: var(--color-text);
	}
	.dtitle .frag {
		color: var(--color-text-muted);
		font-weight: 400;
	}
	.dsub {
		font-size: 12px;
		color: var(--color-text-muted);
		margin-top: 2px;
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		align-items: center;
	}
	.tag {
		font-family: var(--font-mono);
		font-size: 10px;
		padding: 1px 7px;
		border-radius: 20px;
		border: 1px solid var(--color-border-strong);
		color: var(--color-text-muted);
	}
	.tag.translate {
		color: var(--color-good);
		border-color: var(--color-good);
	}
	.tag.orphan {
		color: var(--color-warning);
		border-color: var(--color-warning);
	}
	.dactions {
		display: flex;
		gap: 8px;
		flex: none;
	}
	/* .btn / .btn.primary are shared globals; warn + danger are local variants */
	.btn.warn {
		border-color: var(--color-warning);
		color: var(--color-warning);
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
