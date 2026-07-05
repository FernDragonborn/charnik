<script lang="ts">
	// Roster (home) — the saved characters. Open one into Combat, delete, or create a new one.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { dev } from '$app/environment';
	import { env } from '$env/dynamic/public';
	import { _ } from '$lib/i18n';
	import {
		characters,
		loadRoster,
		openCharacter,
		removeCharacter
	} from '$lib/character/store.svelte';

	// Show the demo banner on the hosted web demo (the Pages build carries the `/charnik` base path),
	// in dev (so it can be previewed), or whenever `PUBLIC_DEMO=true` is set — but NOT in the shipped
	// desktop app (base '', not dev, no env flag).
	const isDemo = env.PUBLIC_DEMO === 'true' || dev || base !== '';

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

	{#if isDemo}
		<aside class="demobanner">
			<div class="db-badge">Demo · in active development</div>
			<h2 class="db-title">This is a live demo — not the full game</h2>
			<p class="db-body">
				Charnik is under active development. This hosted demo ships <b>only SRD content</b>
				(the CC-BY subset), so most of D&amp;D isn't here — for example the
				<b>Artificer</b> class, <b>Aasimar</b>, the <b>Beholder</b>, most
				<b>subclasses</b>, and many <b>spells &amp; monsters</b>. You add your own material as plain
				CSV, and the desktop app keeps all your data local. Expect rough edges.
			</p>
		</aside>
	{/if}

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
	.demobanner {
		display: block;
		margin: 4px 0 22px;
		padding: 18px 22px;
		border: 1px solid var(--color-accent);
		border-left-width: 5px;
		border-radius: 12px;
		background: var(--color-accent-soft, var(--color-surface));
	}
	.db-badge {
		display: inline-block;
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.14em;
		font-size: 11px;
		font-weight: 700;
		color: var(--color-accent-bright);
		border: 1px solid var(--color-accent);
		border-radius: 999px;
		padding: 3px 10px;
		margin-bottom: 10px;
	}
	.db-title {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 22px;
		margin: 0 0 6px;
		color: var(--color-text);
	}
	.db-body {
		margin: 0;
		max-width: 68ch;
		font-size: 15px;
		line-height: 1.55;
		color: var(--color-text-muted);
	}
	.db-body b {
		color: var(--color-text);
		font-weight: 600;
	}
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
