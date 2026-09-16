<script lang="ts">
	// Roster (home) — the saved characters. Open one into Combat, delete, or create a new one.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import Icon from '$lib/components/Icon.svelte';
	import { isDemo } from '$lib/config/demo';
	import { sanitizeHtml } from '$lib/content/markdown';
	import { _ } from '$lib/i18n';
	import {
		characters,
		loadRoster,
		openCharacter,
		removeCharacter,
	} from '$lib/character/store.svelte';
	import { listDrafts, deleteDraft, type DraftRecord } from '$lib/character/draft-repository';
	import { getUserStorage } from '$lib/storage/provider';
	import { systemShortLabel } from '$lib/rules/pipeline';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

	const demo = isDemo();

	let loading = $state(true);
	let error = $state('');
	// Unfinished builds live beside the finished ones: they are the same intention at an earlier
	// stage, and a separate page for them would be a place nobody visits.
	let drafts = $state<DraftRecord[]>([]);
	const reloadDrafts = async () => (drafts = await listDrafts(getUserStorage()));

	onMount(async () => {
		try {
			await loadRoster();
			await reloadDrafts();
		} catch (e) {
			error = (e as Error).message;
		}
		loading = false;
	});

	// Both deletions are irreversible and take everything with them — a character's folder holds the
	// sheet, the portrait, the roll log and every rotating backup — so each goes behind the same
	// confirm the compendium already puts in front of deleting one homebrew ROW.
	let confirming = $state<{ title: string; body: string; label: string; run: () => void } | null>(
		null,
	);

	async function discardDraft(guid: string) {
		await deleteDraft(getUserStorage(), guid);
		await reloadDrafts();
	}

	async function open(slug: string) {
		await openCharacter(slug);
		void goto(`${base}/combat`);
	}
</script>

<svelte:head><title>{$_('nav.roster')} — Charnik</title></svelte:head>

<section class="page">
	<div class="head">
		<div>
			<p class="eyebrow">{$_('app.tagline')}</p>
			<h1>{$_('nav.roster')}</h1>
		</div>
		<a class="new-btn" href="{base}/build">{$_('roster.newCharacter')}</a>
	</div>

	{#if demo}
		<aside class="demobanner">
			<div class="db-badge">{$_('demo.badge')}</div>
			<h2 class="db-title">{$_('demo.title')}</h2>
			<!-- i18n string carries <b> emphasis; sanitized because a user can drop in a locale catalog
			     at runtime (ARCH-3), so the string is not trusted. -->
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitizeHtml on the same value -->
			<p class="db-body">{@html sanitizeHtml($_('demo.body'))}</p>
			<a
				class="db-download"
				href="https://github.com/FernDragonborn/charnik/releases"
				target="_blank"
				rel="noopener noreferrer"
			>
				{$_('demo.download')}
			</a>
		</aside>
	{/if}

	{#if loading}
		<p class="muted">{$_('roster.loading')}</p>
	{:else if error}
		<p class="roster-error">{$_('roster.storageError')} {error}</p>
	{:else if characters.roster.length === 0 && drafts.length === 0}
		<p class="muted">{$_('roster.empty')}</p>
	{:else}
		<ul class="list">
			<!-- a dashed card is the same card, not yet finished: clicking it resumes the build -->
			{#each drafts as d (d.guid)}
				<li class="card roster-card is-draft">
					<a class="roster-open" href="{base}/build?draft={d.guid}">
						<span class="roster-name">
							{d.summary.name || $_('roster.draftUnnamed')}
							<span class="draft-tag">{$_('roster.draft')}</span>
						</span>
						<span class="roster-subtitle">
							{d.summary.classes || $_('roster.draftNoClass')}
							<span class="sysbadge">{systemShortLabel(d.summary.system)}</span>
						</span>
					</a>
					<button
						class="roster-delete"
						title={$_('roster.discardDraft')}
						onclick={() => {
							const name = d.summary.name || $_('roster.draftUnnamed');
							confirming = {
								title: $_('roster.discardDraftTitle', { values: { name } }),
								body: $_('roster.discardDraftBody'),
								label: $_('roster.discardDraftConfirm'),
								run: () => void discardDraft(d.guid),
							};
						}}
					>
						<Icon name="x" label={$_('roster.discardDraft')} />
					</button>
				</li>
			{/each}
			{#each characters.roster as c (c.id)}
				<li class="card roster-card">
					<button class="roster-open" onclick={() => open(c.id)}>
						<span class="roster-name">{c.name}</span>
						<span class="roster-subtitle">
							{c.classes || 'level ' + c.level}
							{#if c.system}<span class="sysbadge">{systemShortLabel(c.system)}</span>{/if}
							{#if c.error}<span class="roster-error"
									><Icon name="triangle-alert" size={13} />
									{c.error}</span
								>{/if}
						</span>
					</button>
					<button
						class="roster-delete"
						title={$_('roster.delete', { values: { name: c.name } })}
						onclick={() => {
							confirming = {
								title: $_('roster.deleteTitle', { values: { name: c.name } }),
								body: $_('roster.deleteBody'),
								label: $_('roster.deleteConfirm'),
								run: () => void removeCharacter(c.id),
							};
						}}
					>
						<Icon name="x" label={$_('roster.delete', { values: { name: c.name } })} />
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if confirming}
		<ConfirmDialog
			title={confirming.title}
			message={confirming.body}
			confirmLabel={confirming.label}
			danger
			onConfirm={() => {
				confirming?.run();
				confirming = null;
			}}
			onCancel={() => (confirming = null)}
		/>
	{/if}
</section>

<style>
	.demobanner {
		display: block;
		margin: var(--space-1) 0 22px;
		padding: 18px 22px;
		border: 1px solid var(--color-accent);
		border-inline-start-width: 5px;
		border-radius: var(--radius-md);
		background: var(--color-accent-soft, var(--color-surface));
	}
	.db-badge {
		display: inline-block;
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		font-size: var(--font-size-xs);
		font-weight: 700;
		color: var(--color-accent-bright);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-full);
		padding: var(--space-1) var(--space-2-5);
		margin-bottom: var(--space-2-5);
	}
	.db-title {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-h5);
		margin: 0 0 var(--space-1-5);
		color: var(--color-text);
	}
	.db-body {
		margin: 0;
		font-size: var(--font-size-body);
		line-height: 1.55;
		color: var(--color-text-muted);
	}
	.db-download {
		display: inline-block;
		margin-top: 14px;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-body);
		text-decoration: none;
		color: var(--color-accent-text);
		background: var(--color-accent-deep);
		border: 1px solid var(--color-accent-deep);
		border-radius: var(--radius);
		padding: var(--space-2) var(--space-4);
	}
	.db-download:hover {
		filter: brightness(1.08);
	}
	.head {
		display: flex;
		/* wraps rather than breaking at a threshold: the title is a translated word beside a
		   nowrap button, so where the pair stops fitting is a property of the locale, not of a width
		   we could name ("+ Новий персонаж" runs 18px over a 393px phone where English clears it) */
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: flex-end;
		gap: var(--space-3);
		margin-bottom: 18px;
	}
	.page :global(h1) {
		font-family: var(--font-display);
		font-size: var(--font-size-2xl);
		margin: var(--space-1) 0 0;
	}
	.eyebrow {
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		font-size: var(--font-size-xs);
		color: var(--color-accent);
		margin: 0;
	}
	.new-btn {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-sm);
		text-decoration: none;
		background: var(--color-accent-deep);
		border: 1px solid var(--color-accent-deep);
		color: var(--color-accent-text);
		border-radius: var(--radius);
		padding: var(--space-2) var(--space-4);
		white-space: nowrap;
	}
	.muted {
		color: var(--color-text-muted);
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: var(--space-2-5);
	}
	.roster-card {
		display: flex;
		align-items: stretch;
		gap: 0;
		padding: 0;
		overflow: hidden;
	}
	.roster-open {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		text-align: start;
		background: transparent;
		border: 0;
		color: var(--color-text);
		padding: 14px var(--space-4);
		cursor: pointer;
		text-decoration: none;
	}
	/* dashed = not finished. The same shape as a saved character on purpose: it IS one, earlier. */
	.roster-card.is-draft {
		border-style: dashed;
		border-color: var(--color-border-strong);
		background: transparent;
	}
	.roster-card.is-draft .roster-name {
		color: var(--color-text-muted);
	}
	.draft-tag {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		color: var(--color-accent-bright);
		border: 1px solid var(--color-accent-deep);
		border-radius: var(--radius-full);
		padding: 1px var(--space-1-5);
		margin-inline-start: var(--space-1-5);
		vertical-align: middle;
	}
	.roster-open:hover {
		background: var(--color-surface-2);
	}
	.roster-name {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-md);
	}
	.roster-subtitle {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		text-transform: capitalize;
	}
	.sysbadge {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 1px var(--space-1-5);
		text-transform: none;
	}
	.roster-error {
		color: var(--color-accent-bright);
	}
	.roster-delete {
		flex: none;
		background: transparent;
		border: 0;
		border-inline-start: 1px solid var(--color-border);
		color: var(--color-border-strong);
		cursor: pointer;
		padding: 0 14px;
		font-size: var(--font-size-sm);
	}
	.roster-delete:hover {
		color: var(--color-accent-bright);
		background: var(--color-surface-2);
	}
</style>
