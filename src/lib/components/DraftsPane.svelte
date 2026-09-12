<script lang="ts">
	// Pending-drafts list — the full-width pane that replaces the editing block in the compendium right
	// column (opened from the "Edit compendium" → Drafts entry). Lists EVERY unsaved draft (translate /
	// add / editor), grouped, each resumable or deletable. Orphans (a draft whose target row is gone) sit
	// up top with a Resolve action that opens the reassign dialog. Presentation + local list state only;
	// the draft IO lives in $lib/drafts/store (thin-component rule).
	import { _ } from '$lib/i18n';
	import { asText, contentTypeLabel } from '$lib/util/format';
	import { onMount } from 'svelte';
	import Icon, { type IconName } from './Icon.svelte';
	import { getUserStorage } from '$lib/storage/provider';
	import { listDrafts, deleteDraft, draftEffectiveId, type DraftEnvelope } from '$lib/drafts/store';
	import { rowName, type ContentGraph } from '$lib/content/loader';

	let {
		graph,
		onResume,
		onResolveOrphans,
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
		icon: IconName;
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
			b.savedAt.localeCompare(a.savedAt),
		);
		loading = false;
	}
	onMount(reload);

	const ICON = {
		translate: 'arrow-left-right',
		add: 'plus',
		editor: 'pencil',
	} as const satisfies Record<string, IconName>;

	/** How long ago a draft was saved, in the reader's units. Read at RENDER (`$derived` below), so a
	 *  language switch re-words it like everything else. */
	function ago(iso: string): string {
		const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
		if (min < 1) return $_('drafts.agoNow');
		if (min < 60) return $_('drafts.agoMinutes', { values: { count: min } });
		const hr = Math.floor(min / 60);
		if (hr < 24) return $_('drafts.agoHours', { values: { count: hr } });
		return $_('drafts.agoDays', { values: { count: Math.floor(hr / 24) } });
	}

	function toRow(env: DraftEnvelope): DraftRow {
		const t = env.target;
		const typeLabel = $_(`contentType.${t.type}`, { default: contentTypeLabel(t.type) });
		if (t.kind === 'add') {
			const name = asText(env.data.name_en).trim();
			return {
				env,
				kind: 'add',
				icon: ICON.add,
				title: name || 'Untitled',
				fragment: $_(name ? 'drafts.fragmentNew' : 'drafts.fragmentNewUnsaved', {
					values: { type: typeLabel },
				}),
				typeLabel,
				isOrphan: false,
				age: ago(env.savedAt),
			};
		}
		const eid = draftEffectiveId(t);
		const row = eid ? graph.get(eid) : undefined;
		const title = row ? rowName(row) : t.id;
		return {
			env,
			kind: t.kind,
			icon: ICON[t.kind],
			title,
			fragment:
				t.kind === 'translate' ? `→ ${t.locale.toUpperCase()}` : $_('drafts.fragmentEditAll'),
			typeLabel,
			isOrphan: !row,
			age: ago(env.savedAt),
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
		<h2 class="dp-title">{$_('drafts.title')}</h2>
		<span class="dp-sub">
			{#if loading}{$_('drafts.loading')}{:else}{$_('drafts.count', {
					values: { count: drafts.length },
				})}{/if}
		</span>
	</div>
	<p class="dp-hint">{$_('drafts.hint')}</p>

	{#if !loading && drafts.length === 0}
		<p class="dp-empty">{$_('drafts.empty')}</p>
	{/if}

	{#snippet group(label: string, items: DraftRow[], resolvable: boolean)}
		{#if items.length}
			<div class="dp-group-label eyebrow">{label}</div>
			{#each items as r (r.env.target)}
				<div class="draft" class:is-orphan={r.isOrphan}>
					<div class="dkind {r.kind}"><Icon name={r.icon} size={13} /></div>
					<div class="dmeta">
						<div class="dtitle">{r.title} <span class="frag">{r.fragment}</span></div>
						<div class="dsub">
							{#if r.isOrphan}
								<span class="tag orphan">{$_('drafts.orphanTag')}</span>
								<span>{$_('drafts.orphanReason')}</span>
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
								{$_('drafts.resolve')}
							</button>
						{:else}
							<button class="btn primary" onclick={() => onResume(r.env)}
								>{$_('drafts.resume')}</button
							>
						{/if}
						<button class="btn danger" onclick={() => remove(r.env)}>{$_('drafts.delete')}</button>
					</div>
				</div>
			{/each}
		{/if}
	{/snippet}

	{@render group($_('drafts.groupOrphans'), orphanRows, true)}
	{@render group($_('drafts.groupTranslations'), translateRows, false)}
	{@render group($_('drafts.groupAdded'), addRows, false)}
	{@render group($_('drafts.groupEditor'), editorRows, false)}
</div>

<style>
	.drafts-pane {
		padding: 20px 22px 28px;
		max-width: 760px;
	}
	.dp-head {
		display: flex;
		align-items: baseline;
		gap: var(--space-2-5);
	}
	.dp-title {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-h5);
		margin: 0;
	}
	.dp-sub {
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
	}
	.dp-hint {
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
		margin: var(--space-1) 0 18px;
	}
	.dp-empty {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		padding: 20px 0;
	}
	.dp-group-label {
		font-size: var(--font-size-micro);
		margin: 18px 0 var(--space-2);
	}
	.draft {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-2-5) var(--space-3);
		margin-bottom: var(--space-2);
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
		border-radius: var(--radius);
		display: grid;
		place-items: center;
		font-size: var(--font-size-body);
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
		font-size: var(--font-size-body);
		font-weight: 600;
		color: var(--color-text);
	}
	.dtitle .frag {
		color: var(--color-text-muted);
		font-weight: 400;
	}
	.dsub {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin-top: 2px;
		display: flex;
		gap: var(--space-2-5);
		flex-wrap: wrap;
		align-items: center;
	}
	.tag {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		padding: 1px var(--space-1-5);
		border-radius: var(--radius-full);
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
		gap: var(--space-2);
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
