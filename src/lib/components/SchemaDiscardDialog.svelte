<script lang="ts">
	import { asText } from '$lib/util/format';
	import Icon from './Icon.svelte';
	import { dismissOnEscape } from '$lib/actions/dismissOnEscape';
	import { trapFocus } from '$lib/actions/trapFocus';
	// Schema-discard warning — the house attention-dialog template
	// (charnik-dialog-design-template), single-pane notice variant. Fires when the draft cache holds
	// drafts saved under a DIFFERENT content-schema version: ephemeral WIP that can't be migrated, so it
	// WILL be dropped. We surface exactly what's being lost + let the user acknowledge, rather than
	// having their unsaved work vanish silently on the next read (PLAN DRAFT-CACHE backlog).
	import type { DraftEnvelope } from '$lib/drafts/store';

	let {
		drafts,
		unreadable = [],
		onDiscard,
		onKeep,
	}: {
		drafts: DraftEnvelope[];
		/** Paths of draft files that no longer parse — the same loss with a different cause, so they are
		 *  listed here rather than getting a dialog of their own. Nothing inside can be read, so the file
		 *  name is all there is to show. */
		unreadable?: string[];
		/** user acknowledged — delete the stale files */
		onDiscard: () => void;
		/** dismiss without deleting (they stay on disk, still ignored until the schema matches again) */
		onKeep: () => void;
	} = $props();

	const total = $derived(drafts.length + unreadable.length);

	function draftLabel(env: DraftEnvelope): { title: string; sub: string } {
		const t = env.target;
		if (t.kind === 'add')
			return {
				title: asText(env.data.name_en, 'Untitled'),
				sub: `new ${t.type.replace(/_/g, ' ')}`,
			};
		if (t.kind === 'translate')
			return { title: t.id, sub: `${t.type.replace(/_/g, ' ')} → ${t.locale.toUpperCase()}` };
		return { title: t.id, sub: `${t.type.replace(/_/g, ' ')} · edit` };
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="dialog-backdrop" onclick={onKeep}></div>
<div
	class="dialog discard-dialog"
	role="dialog"
	aria-modal="true"
	aria-labelledby="discard-title"
	tabindex="-1"
	use:dismissOnEscape={onKeep}
	use:trapFocus
>
	<header class="dialog-head">
		<span class="dialog-badge warn"><Icon name="flag" size={17} /></span>
		<h2 id="discard-title" class="dialog-title">
			Some drafts can’t be restored{#if total > 1}<span class="count-pill">{total}</span>{/if}
		</h2>
		<p class="dialog-subtitle">
			{#if drafts.length}{drafts.length === 1
					? 'An unfinished edit was'
					: `${drafts.length} unfinished edits were`} saved under an older content schema and can’t be
				migrated forward.{/if}
			{#if unreadable.length}{unreadable.length === 1
					? 'One draft file'
					: `${unreadable.length} draft files`} can no longer be read at all — the contents are damaged,
				so there is nothing left in them to restore.{/if}
			Discarding them frees the space; keeping them leaves the files on disk (still ignored) in case a
			future version can read them.
		</p>
	</header>

	<div class="dialog-body list">
		{#each drafts as env (env.target)}
			{@const l = draftLabel(env)}
			<div class="dialog-card row">
				<div class="meta">
					<div class="title">{l.title}</div>
					<div class="sub">{l.sub}</div>
				</div>
				<div class="ver">schema v{env.schemaVersion}</div>
			</div>
		{/each}
		{#each unreadable as path (path)}
			<div class="dialog-card row">
				<div class="meta">
					<div class="title">{path.slice(path.lastIndexOf('/') + 1)}</div>
					<div class="sub">unreadable file</div>
				</div>
			</div>
		{/each}
	</div>

	<footer class="dialog-foot">
		<span class="dialog-spacer"></span>
		<button class="btn ghost" onclick={onKeep}>Keep for now</button>
		<button class="btn primary" onclick={onDiscard}>
			Discard {total}
			{total === 1 ? 'draft' : 'drafts'}
		</button>
	</footer>
</div>

<style>
	.discard-dialog {
		width: min(560px, calc(100vw - 2 * var(--space-4)));
	}
	/* base look = global .dialog-body / .dialog-card; only the tighter gap + row layout are local */
	.list {
		gap: var(--space-2);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
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
