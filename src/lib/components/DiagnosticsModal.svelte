<script lang="ts">
	// The bug report (audit DIAG-1): one field for what happened and one button that opens a GitHub
	// issue already written — the words, then a PII-FREE snapshot (version, platform, build-shape
	// character summary, recent log tail) the user can unfold and read first. A report nobody can
	// send in one step is a report nobody sends. Nothing leaves the app but by that press, and the
	// full snapshot also goes to the clipboard, since a link has a length (`diag/issue-link.ts`).
	import DialogShell from './DialogShell.svelte';
	import { _ } from '$lib/i18n';
	import { toast } from '$lib/toast/toast';
	import { app } from '$lib/stores/app.svelte';
	import { characters } from '$lib/character/store.svelte';
	import { content } from '$lib/content/store.svelte';
	import { detectPlatform } from '$lib/storage/provider';
	import { getLogTail } from '$lib/diag/logger';
	import { buildDiagnostics, formatBundle } from '$lib/diag/bundle';
	import { issueLink } from '$lib/diag/issue-link';

	let { onDismiss }: { onDismiss: () => void } = $props();

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
						driftItems: graph.driftItems.length,
					},
				}
			: {}),
	});
	const bundleText = formatBundle(bundle);

	let description = $state('');
	const link = $derived(
		issueLink(
			ISSUE_URL,
			{
				description,
				fallbackTitle: $_('feedback.diag.fallbackTitle'),
				shortenedNote: $_('feedback.diag.shortenedNote'),
			},
			bundle,
		),
	);

	/** The press that sends: the whole snapshot to the clipboard as well, in case the link was
	 *  shortened; the link itself opens in the browser as any outside link does. */
	function keepFullCopy(): void {
		// best-effort: the report still opens without it, and says if its log was cut
		navigator.clipboard
			.writeText(bundleText)
			.catch(() => toast.error($_('feedback.diag.copyFailed')));
	}
</script>

<DialogShell
	titleId="diag-title"
	ask={$_('feedback.diag.title')}
	title={$_('feedback.diag.tell')}
	width="min(640px, calc(100vw - 2 * var(--space-4)))"
	{onDismiss}
>
	<div class="dialog-body">
		<textarea
			class="text-field diag-words"
			rows="4"
			maxlength="4000"
			aria-labelledby="diag-title"
			placeholder={$_('feedback.diag.tellPlaceholder')}
			bind:value={description}></textarea>
		<details class="diag-attached">
			<summary>{$_('feedback.diag.attached')}</summary>
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
						{bundle.contentIssues.issues} · {bundle.contentIssues.metaIssues} · {bundle
							.contentIssues.driftItems}
					</dd>
				{/if}
			</dl>
			<pre class="diag-preview" aria-label={$_('feedback.diag.previewAria')}>{bundleText}</pre>
		</details>
		<p class="diag-how">{$_('feedback.diag.how')}</p>
		{#if link.shortened}<p class="diag-how">{$_('feedback.diag.shortened')}</p>{/if}
	</div>

	<footer class="dialog-foot">
		<button class="btn" onclick={onDismiss}>{$_('feedback.diag.close')}</button>
		<span class="dialog-spacer"></span>
		<a
			class="btn primary"
			href={link.url}
			target="_blank"
			rel="noopener noreferrer"
			onclick={keepFullCopy}>{$_('feedback.diag.send')}</a
		>
	</footer>
</DialogShell>

<style>
	.diag-words {
		width: 100%;
		resize: vertical;
		padding: var(--space-2) var(--space-3);
		font: inherit;
		font-size: var(--font-size-body);
	}
	.diag-attached summary {
		cursor: pointer;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.diag-attached[open] summary {
		margin-bottom: var(--space-2);
	}
	.diag-how {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
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
