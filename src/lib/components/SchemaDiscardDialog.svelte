<script lang="ts">
	import { asText } from '#lib/util/format.ts';
	import DialogShell from './DialogShell.svelte';
	import { _ } from '#lib/i18n/index.ts';
	// Schema-discard warning — the house attention-dialog template
	// (charnik-dialog-design-template), single-pane notice variant. Fires when the draft cache holds
	// drafts saved under a DIFFERENT content-schema version: ephemeral WIP that can't be migrated, so it
	// WILL be dropped. We surface exactly what's being lost + let the user acknowledge, rather than
	// having their unsaved work vanish silently on the next read (PLAN DRAFT-CACHE backlog).
	import type { DraftEnvelope } from '#lib/drafts/store.ts';

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

	/** A draft's two lines. The content TYPE is the app's own vocabulary and reads from `contentType`;
	 *  the entry's id and the target locale are data and pass through. */
	function draftLabel(env: DraftEnvelope): { title: string; sub: string } {
		const t = env.target;
		const type = $_(`contentType.${t.type}`, { default: t.type.replace(/_/g, ' ') });
		if (t.kind === 'add')
			return {
				title: asText(env.data.name_en, $_('drafts.discard.untitled')),
				sub: $_('drafts.discard.subNew', { values: { type } }),
			};
		if (t.kind === 'translate')
			return {
				title: t.id,
				sub: $_('drafts.discard.subTranslate', {
					values: { type, locale: t.locale.toUpperCase() },
				}),
			};
		return { title: t.id, sub: $_('drafts.discard.subEdit', { values: { type } }) };
	}
</script>

<DialogShell
	titleId="discard-title"
	title={$_('drafts.discard.title')}
	subtitle={[
		drafts.length ? $_('drafts.discard.stale', { values: { count: drafts.length } }) : '',
		unreadable.length
			? $_('drafts.discard.unreadable', { values: { count: unreadable.length } })
			: '',
	]
		.filter(Boolean)
		.join(' ')}
	width="min(560px, calc(100vw - 2 * var(--space-4)))"
	onDismiss={onKeep}
>
	<!-- each count is a WHOLE sentence per plural branch, never a phrase glued to a number: a
	     language with more than two branches (Ukrainian has three) cannot be served by picking
	     between two English fragments and appending the rest. -->
	<div class="dialog-body list">
		{#each drafts as env (env.target)}
			{@const l = draftLabel(env)}
			<div class="dialog-card row">
				<div class="meta">
					<div class="title">{l.title}</div>
					<div class="sub">{l.sub}</div>
				</div>
				<div class="ver">
					{$_('drafts.discard.schemaVersion', { values: { version: env.schemaVersion } })}
				</div>
			</div>
		{/each}
		{#each unreadable as path (path)}
			<div class="dialog-card row">
				<div class="meta">
					<div class="title">{path.slice(path.lastIndexOf('/') + 1)}</div>
					<div class="sub">{$_('drafts.discard.unreadableFile')}</div>
				</div>
			</div>
		{/each}
		<p class="tail">{$_('drafts.discard.tail')}</p>
	</div>

	<footer class="dialog-foot">
		<button class="btn" onclick={onKeep}>{$_('drafts.discard.keep')}</button>
		<span class="dialog-spacer"></span>
		<button class="btn danger" onclick={onDiscard}
			>{$_('drafts.discard.action', { values: { count: total } })}</button
		>
	</footer>
</DialogShell>

<style>
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
	.tail {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.ver {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		flex: none;
	}
</style>
