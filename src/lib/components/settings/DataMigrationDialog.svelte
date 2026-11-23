<script lang="ts">
	// The result of a data-folder move that did not simply succeed. It stays until it is answered —
	// a failure needs time to be read, with the reassurance that the original data is safe — so a
	// click on the backdrop or Escape does not close it. When the move worked but the old folder
	// stayed, it says what is in that folder, why it most likely stayed, and offers to try again or
	// to show the folder; the raw reason waits under "Details".
	import { _ } from '#lib/i18n/index.ts';
	import DialogShell from '../DialogShell.svelte';
	import type { LeftFolder } from '#lib/storage/tauri.ts';

	let {
		title,
		detail,
		note,
		newDir = '',
		left,
		reason = '',
		retrying = false,
		onRetry,
		onReveal,
		onclose,
	}: {
		title: string;
		/** What happened, in one sentence (the fs reason / mismatch count). */
		detail: string;
		/** Reassurance, said first, e.g. that the original folder is untouched. */
		note?: string | undefined;
		/** The folder Charnik reads now, when the move went through. */
		newDir?: string | undefined;
		/** The old folder a move could not remove, and what it still holds. */
		left?: LeftFolder | undefined;
		/** The system's own words for why — shown only under "Details". */
		reason?: string | undefined;
		retrying?: boolean;
		onRetry?: (() => void) | undefined;
		onReveal?: (() => void) | undefined;
		onclose: () => void;
	} = $props();

	// "access denied" and "in use" are the ways a folder stays on Windows; said as what to do
	const locked = $derived(/denied|os error (5|32)|in use|EACCES|EBUSY|EPERM/i.test(reason));
	const size = (bytes: number) =>
		bytes >= 1048576
			? `${(bytes / 1048576).toFixed(1)} MB`
			: `${Math.max(1, Math.round(bytes / 1024))} KB`;
	let closeBtn = $state<HTMLButtonElement | null>(null);
</script>

<DialogShell
	titleId="mig-title"
	{title}
	subtitle={note ? `${note} ${detail}` : detail}
	width="min(640px, calc(100vw - 2 * var(--space-4)))"
	initialFocus={closeBtn}
>
	{#if left}
		<div class="dialog-body">
			<dl class="where">
				{#if newDir}<dt>{$_('settings.migrate.nowReads')}</dt>
					<dd class="path">{newDir}</dd>{/if}
				<dt>{$_('settings.migrate.leftCopy')}</dt>
				<dd>
					<span class="path">{left.dir}</span>
					<span class="count"
						>{$_('settings.migrate.leftCount', {
							values: { files: left.files, size: size(left.bytes) },
						})}</span
					>
				</dd>
			</dl>
			<p class="why">
				{locked ? $_('settings.migrate.whyLocked') : $_('settings.migrate.whyOther')}
			</p>
			{#if reason}
				<details class="raw">
					<summary>{$_('settings.migrate.details')}</summary>
					<p>{reason}</p>
				</details>
			{/if}
		</div>
	{/if}

	<footer class="dialog-foot">
		{#if left}
			<button class="btn" bind:this={closeBtn} onclick={onclose}
				>{$_('settings.migrate.keepAsIs')}</button
			>
			{#if onReveal}
				<button class="btn ghost reveal" onclick={onReveal}
					>{$_('settings.migrate.revealOld')}</button
				>
			{/if}
			<span class="dialog-spacer"></span>
			{#if onRetry}
				<button class="btn primary" disabled={retrying} onclick={onRetry}
					>{$_('settings.migrate.retry')}</button
				>
			{/if}
		{:else}
			<span class="dialog-spacer"></span>
			<button class="btn primary" bind:this={closeBtn} onclick={onclose}>{$_('app.close')}</button>
		{/if}
	</footer>
</DialogShell>

<style>
	.where {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: var(--space-2) var(--space-4);
		margin: 0;
		padding: var(--space-3) 0;
		border-top: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
	}
	.where dt {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.where dd {
		display: flex;
		flex-direction: column;
		margin: 0;
		min-width: 0;
	}
	.path {
		font-size: var(--font-size-sm);
		color: var(--color-text);
		overflow-wrap: anywhere;
	}
	.count {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.why {
		margin: 0;
		font-size: var(--font-size-body);
	}
	.raw summary {
		cursor: pointer;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.raw p {
		margin: var(--space-2) 0 0;
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}
	/* a way to look, not an answer: said as a link beside "leave it" */
	.reveal {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
</style>
