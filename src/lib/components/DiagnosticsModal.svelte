<script lang="ts">
	// The bug-report diagnostics step (audit DIAG-1). Instead of jumping straight to GitHub with
	// nothing to attach, this shows a PII-FREE snapshot (version, platform, build-shape character
	// summary, recent log tail) that the user reviews and copies to the clipboard, then pastes into an
	// issue. Local-first, no auto-upload — nothing leaves the app until the user pastes it.
	import DialogShell from './DialogShell.svelte';
	import { _ } from '$lib/i18n';
	import { toast } from 'svelte-sonner';
	import { app } from '$lib/stores/app.svelte';
	import { characters } from '$lib/character/store.svelte';
	import { content } from '$lib/content/store.svelte';
	import { detectPlatform, Platform } from '$lib/storage/provider';
	import { getLogTail, openLogDir } from '$lib/diag/logger';
	import { buildDiagnostics, formatBundle } from '$lib/diag/bundle';

	let { onDismiss }: { onDismiss: () => void } = $props();

	const isDesktop = detectPlatform() === Platform.Desktop;
	const ISSUE_URL = 'https://github.com/FernDragonborn/charnik/issues/new';

	// Snapshot once when the modal opens — a bug report is a point-in-time capture, not a live feed.
	const graph = content.graph;
	const bundle = buildDiagnostics({
		appVersion: __APP_VERSION__,
		platform: detectPlatform(),
		activeSystem: app.activeEditions.join(', '),
		activeLocale: app.activeLocale,
		character: characters.active,
		logTail: getLogTail(),
		...(graph
			? {
					contentIssues: {
						issues: graph.issues.length,
						metaIssues: graph.metaIssues.length,
						driftItems: graph.driftItems.length
					}
				}
			: {})
	});
	const bundleText = formatBundle(bundle);

	async function copyDiagnostics() {
		try {
			await navigator.clipboard.writeText(bundleText);
			toast.success($_('feedback.diag.copied'));
		} catch {
			toast.error($_('feedback.diag.copyFailed'));
		}
	}
</script>

<DialogShell
	titleId="diag-title"
	title={$_('feedback.diag.title')}
	subtitle={$_('feedback.diag.subtitle')}
	width="min(640px, calc(100vw - 2 * var(--space-4)))"
	badge="🐞"
	{onDismiss}
>
	<div class="dialog-body">
		<dl class="diag-facts">
			<dt>{$_('feedback.diag.version')}</dt>
			<dd>{bundle.appVersion}</dd>
			<dt>{$_('feedback.diag.platform')}</dt>
			<dd>{bundle.platform}</dd>
			<dt>{$_('feedback.diag.system')}</dt>
			<dd>{bundle.activeSystem} · {bundle.activeLocale}</dd>
			<dt>{$_('feedback.diag.character')}</dt>
			<dd>
				{#if bundle.character}
					{bundle.character.classes.map((c) => `${c.class} ${c.level}`).join(' / ') ||
						bundle.character.id}
					· lvl {bundle.character.totalLevel} · {bundle.character.system}
				{:else}
					{$_('feedback.diag.noCharacter')}
				{/if}
			</dd>
			{#if bundle.contentIssues}
				<dt>{$_('feedback.diag.content')}</dt>
				<dd>
					{bundle.contentIssues.issues} · {bundle.contentIssues.metaIssues} · {bundle.contentIssues
						.driftItems}
				</dd>
			{/if}
		</dl>

		<p class="diag-count">
			{$_('feedback.diag.logLines', { values: { count: bundle.log.length } })}
		</p>
		<pre class="diag-preview" aria-label="diagnostics">{bundleText}</pre>
	</div>

	<footer class="dialog-foot">
		{#if isDesktop}
			<button class="btn ghost" onclick={openLogDir}>{$_('feedback.diag.openLogFolder')}</button>
		{/if}
		<span class="dialog-spacer"></span>
		<a class="btn ghost" href={ISSUE_URL} target="_blank" rel="noopener noreferrer">
			{$_('feedback.diag.openIssue')}
		</a>
		<button class="btn primary" onclick={copyDiagnostics}>{$_('feedback.diag.copy')}</button>
	</footer>
</DialogShell>

<style>
	.diag-facts {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--space-1) var(--space-3);
		margin: 0 0 var(--space-3);
	}
	.diag-facts dt {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.diag-facts dd {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		color: var(--color-text);
		overflow-wrap: anywhere;
	}
	.diag-count {
		margin: 0 0 var(--space-2);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.diag-preview {
		max-height: 30vh;
		overflow: auto;
		margin: 0;
		padding: var(--space-3);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
</style>
