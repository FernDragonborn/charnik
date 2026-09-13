<script lang="ts">
	import { asText } from '$lib/util/format';
	import Icon from './Icon.svelte';
	import { _ } from '$lib/i18n';
	import { dismissOnEscape } from '$lib/actions/dismissOnEscape';
	import { trapFocus } from '$lib/actions/trapFocus';
	// Schema-discard warning — the house attention-dialog template
	// (charnik-dialog-design-template), single-pane notice variant. Fires when the draft cache holds
	// drafts saved under a DIFFERENT content-schema version: ephemeral WIP that can't be migrated, so it
	// WILL be dropped. We surface exactly what's being lost + let the user acknowledge, rather than
	// having their unsaved work vanish silently on the next read (PLAN DRAFT-CACHE backlog).
	import type { DraftEnvelope } from '$lib/drafts/store';
	import LangSwitcher from './LangSwitcher.svelte';

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
		<div class="dialog-lang-corner"><LangSwitcher /></div>
		<span class="dialog-badge warn"><Icon name="flag" size={17} /></span>
		<h2 id="discard-title" class="dialog-title">
			{$_('drafts.discard.title')}{#if total > 1}<span class="count-pill">{total}</span>{/if}
		</h2>
		<!-- each count is a WHOLE sentence per plural branch, never a phrase glued to a number: a
		     language with more than two branches (Ukrainian has three) cannot be served by picking
		     between two English fragments and appending the rest. -->
		<p class="dialog-subtitle">
			{#if drafts.length}{$_('drafts.discard.stale', { values: { count: drafts.length } })}{/if}
			{#if unreadable.length}{$_('drafts.discard.unreadable', {
					values: { count: unreadable.length },
				})}{/if}
			{$_('drafts.discard.tail')}
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
	</div>

	<footer class="dialog-foot">
		<span class="dialog-spacer"></span>
		<button class="btn ghost" onclick={onKeep}>{$_('drafts.discard.keep')}</button>
		<button class="btn primary" onclick={onDiscard}
			>{$_('drafts.discard.action', { values: { count: total } })}</button
		>
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
