<script lang="ts">
	// Schema-discard warning — the house attention-dialog template
	// (charnik-dialog-design-template), single-pane notice variant. Fires when the draft cache holds
	// drafts saved under a DIFFERENT content-schema version: ephemeral WIP that can't be migrated, so it
	// WILL be dropped. We surface exactly what's being lost + let the user acknowledge, rather than
	// having their unsaved work vanish silently on the next read (PLAN DRAFT-CACHE backlog).
	import type { DraftEnvelope } from '$lib/drafts/store';

	let {
		drafts,
		onDiscard,
		onKeep
	}: {
		drafts: DraftEnvelope[];
		/** user acknowledged — delete the stale files */
		onDiscard: () => void;
		/** dismiss without deleting (they stay on disk, still ignored until the schema matches again) */
		onKeep: () => void;
	} = $props();

	function draftLabel(env: DraftEnvelope): { title: string; sub: string } {
		const t = env.target;
		if (t.kind === 'add')
			return {
				title: String(env.data.name_en ?? 'Untitled'),
				sub: `new ${t.type.replace(/_/g, ' ')}`
			};
		if (t.kind === 'translate')
			return { title: t.id, sub: `${t.type.replace(/_/g, ' ')} → ${t.locale.toUpperCase()}` };
		return { title: t.id, sub: `${t.type.replace(/_/g, ' ')} · edit` };
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onKeep();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="dialog-backdrop" onclick={onKeep}></div>
<div class="dialog discard-dialog" role="dialog" aria-modal="true" aria-labelledby="discard-title">
	<header class="dialog-head">
		<span class="dialog-badge discard-badge">⚑</span>
		<h2 id="discard-title" class="dialog-title">
			Older drafts can’t be restored{#if drafts.length > 1}<span class="count-pill"
					>{drafts.length}</span
				>{/if}
		</h2>
		<p class="dialog-subtitle">
			{drafts.length === 1 ? 'An unfinished edit was' : `${drafts.length} unfinished edits were`} saved
			under an older content schema and can’t be migrated forward. Discarding them frees the space; keeping
			them leaves the files on disk (still ignored) in case a future version can read them.
		</p>
	</header>

	<div class="list">
		{#each drafts as env (env.target)}
			{@const l = draftLabel(env)}
			<div class="row">
				<div class="meta">
					<div class="title">{l.title}</div>
					<div class="sub">{l.sub}</div>
				</div>
				<div class="ver">schema v{env.schemaVersion}</div>
			</div>
		{/each}
	</div>

	<footer class="dialog-foot">
		<span class="dialog-spacer"></span>
		<button class="btn ghost" onclick={onKeep}>Keep for now</button>
		<button class="btn primary" onclick={onDiscard}>
			Discard {drafts.length}
			{drafts.length === 1 ? 'draft' : 'drafts'}
		</button>
	</footer>
</div>

<style>
	.discard-dialog {
		width: min(560px, calc(100vw - 2 * var(--space-4)));
	}
	.discard-badge {
		color: var(--color-warning);
	}
	.count-pill {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-warning);
		border: 1px solid var(--color-warning);
		border-radius: 20px;
		padding: 1px 9px;
		margin-left: var(--space-3);
		vertical-align: middle;
	}
	.list {
		overflow: auto;
		padding: var(--space-4) var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-3) var(--space-4);
	}
	.meta {
		flex: 1;
		min-width: 0;
	}
	.title {
		font-size: var(--font-size-md);
		font-weight: 600;
		color: var(--color-text);
	}
	.sub {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin-top: 2px;
	}
	.ver {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		flex: none;
	}
</style>
