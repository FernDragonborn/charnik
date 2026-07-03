<script lang="ts">
	// Roster (home) — the saved characters. Open one into Combat, delete, or create a new one.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { _ } from '$lib/i18n';
	import {
		characters,
		loadRoster,
		openCharacter,
		removeCharacter
	} from '$lib/character/store.svelte';

	let loading = $state(true);
	let error = $state('');
	onMount(async () => {
		try {
			await loadRoster();
		} catch (e) {
			error = (e as Error).message;
		}
		loading = false;
	});

	async function open(slug: string) {
		await openCharacter(slug);
		goto(`${base}/combat`);
	}
</script>

<svelte:head><title>{$_('nav.roster')} — Charnik</title></svelte:head>

<section class="page">
	<div class="head">
		<div>
			<p class="eyebrow">{$_('app.tagline')}</p>
			<h1>{$_('nav.roster')}</h1>
		</div>
		<a class="new" href="{base}/build">+ New character</a>
	</div>

	{#if loading}
		<p class="muted">Loading…</p>
	{:else if error}
		<p class="rerr">Storage error — {error}</p>
	{:else if characters.roster.length === 0}
		<p class="muted">No characters yet. Create one to get started.</p>
	{:else}
		<ul class="list">
			{#each characters.roster as c (c.id)}
				<li class="card rcard">
					<button class="ropen" onclick={() => open(c.id)}>
						<span class="rname">{c.name}</span>
						<span class="rsub">
							{c.classes || 'level ' + c.level}
							<span class="sysbadge">{c.system}</span>
							{#if c.error}<span class="rerr">⚠ {c.error}</span>{/if}
						</span>
					</button>
					<button class="rdel" title="Delete {c.name}" onclick={() => removeCharacter(c.id)}
						>✕</button
					>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.head {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 12px;
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
	.new {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 13px;
		text-decoration: none;
		background: var(--color-accent-deep);
		border: 1px solid var(--color-accent-deep);
		color: #fff;
		border-radius: 8px;
		padding: 8px 16px;
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
		gap: 10px;
	}
	.rcard {
		display: flex;
		align-items: stretch;
		gap: 0;
		padding: 0;
		overflow: hidden;
	}
	.ropen {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
		text-align: left;
		background: transparent;
		border: 0;
		color: var(--color-text);
		padding: 14px 16px;
		cursor: pointer;
	}
	.ropen:hover {
		background: var(--color-surface-2);
	}
	.rname {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 16px;
	}
	.rsub {
		display: flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-text-muted);
		text-transform: capitalize;
	}
	.sysbadge {
		border: 1px solid var(--color-border);
		border-radius: 5px;
		padding: 1px 6px;
		text-transform: none;
	}
	.rerr {
		color: var(--color-accent-bright);
	}
	.rdel {
		flex: none;
		background: transparent;
		border: 0;
		border-left: 1px solid var(--color-border);
		color: var(--color-border-strong);
		cursor: pointer;
		padding: 0 14px;
		font-size: 13px;
	}
	.rdel:hover {
		color: var(--color-accent-bright);
		background: var(--color-surface-2);
	}
</style>
