<script lang="ts">
	// Dev toolbox index (dev-server only — gated by the /dev layout). Small maintenance actions that
	// don't belong in the shipped UI. Links to the design-preview pages live here too.
	import Icon from '$lib/components/Icon.svelte';
	import { toast } from 'svelte-sonner';
	import { base } from '$app/paths';
	import { recreateDemoCharacter } from '$lib/character/store.svelte';

	// `/dev` has no trailing slash, so a RELATIVE href resolved to `/<page>` and 404'd — these are
	// absolute, through `base` like every other internal link.
	const dev = (page: string) => `${base}/dev/${page}`;

	let busy = $state(false);
	async function recreateDemo() {
		busy = true;
		try {
			const demo = await recreateDemoCharacter();
			toast(`Demo character reset — ${demo.build.name}`);
		} finally {
			busy = false;
		}
	}
</script>

<div class="page">
	<h1>Dev toolbox</h1>

	<section>
		<h2>Character</h2>
		<button class="action" onclick={recreateDemo} disabled={busy}
			><Icon name="recycle" size={13} /> Recreate demo character</button
		>
		<p class="hint">
			Overwrites the persisted demo save with a fresh build and makes it active — wipes accumulated
			demo edits (hidden spells, HP, layout).
		</p>
	</section>

	<section>
		<h2>Design previews</h2>
		<ul>
			<li><a href={dev('meta')}>Content-metadata modal</a></li>
			<li><a href={dev('drift')}>Hash-drift review</a></li>
			<li><a href={dev('health')}>Content health — the problem states</a></li>
			<li><a href={dev('firstrun')}>First-run flow</a></li>
			<li><a href={dev('deathsaves')}>Death saves</a></li>
			<li><a href={dev('rolltoast')}>Roll toast</a></li>
			<li><a href={dev('roller')}>Dice tray</a></li>
			<li><a href={dev('plugins')}>Plugins</a></li>
			<li><a href={dev('storage')}>Storage</a></li>
			<li><a href={dev('packs')}>Content packs (fixture)</a></li>
			<li><a href={dev('inspector')}>Builder inspector — every target at once</a></li>
		</ul>
	</section>

	<!-- The three that only mean something inside the desktop app: the network client and the disk
	     both live in the shell, so a browser tab can say nothing about either. Listed here
	     because a probe nobody can find is a probe nobody runs. -->
	<section>
		<h2>Live probes — desktop only</h2>
		<ul>
			<li><a href={dev('packs-live')}>Pack update · network (read-only)</a></li>
			<li><a href={dev('packs-write')}>Pack update · apply on the real filesystem</a></li>
			<li>
				<a href={dev('characters-write')}>Characters · portraits, backups and drafts on the disk</a>
			</li>
		</ul>
		<p class="hint">
			The first only reads and reaches GitHub. The other two write, inside a throwaway pack and a
			throwaway character they delete afterwards, and never touch the network. All three leave a
			report in your data folder.
		</p>
	</section>
</div>

<style>
	.page {
		max-width: 640px;
		margin: 0 auto;
		padding: var(--space-4);
	}
	h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-2xl);
		margin: 0 0 20px;
	}
	h2 {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin: var(--space-5) 0 var(--space-2-5);
	}
	.action {
		font-family: var(--font-body);
		font-size: var(--font-size-sm);
		color: var(--color-text);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius);
		padding: var(--space-2) 14px;
		cursor: pointer;
	}
	.action:hover {
		border-color: var(--color-accent);
	}
	.action:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.hint {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin: var(--space-2) 0 0;
	}
	ul {
		margin: 0;
		padding-inline-start: 20px;
	}
	li {
		margin: var(--space-1) 0;
	}
	a {
		color: var(--color-accent);
	}
</style>
