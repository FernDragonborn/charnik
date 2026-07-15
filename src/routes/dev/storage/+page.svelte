<script lang="ts">
	// DEV-ONLY preview of the Settings → Data section and the persistent migration-notice dialog. Not
	// linked from the app; open /dev/storage to see it live. The real section is desktop-gated (Tauri
	// fs), so this reproduces the rows statically and drives DataMigrationDialog through each state so
	// it previews in a plain browser.
	import DataMigrationDialog from '$lib/components/settings/DataMigrationDialog.svelte';
	import DataConflictDialog from '$lib/components/settings/DataConflictDialog.svelte';
	import { conflictRows, type DirFile } from '$lib/storage/migrate';

	// Sample two folders that overlap, to preview the conflict table (collisions highlight the newer side).
	const day = 24 * 3600_000;
	const t = (d: number) => Date.UTC(2026, 6, d);
	const current: DirFile[] = [
		{ path: 'characters/aria/character.json', size: 4200, mtime: t(11) },
		{ path: 'content/srd/spells.csv', size: 90_000, mtime: t(2) },
		{ path: 'content/srd/species.csv', size: 12_000, mtime: t(9) - day },
		{ path: 'homebrew/my-feats.csv', size: 800, mtime: t(10) }
	];
	const chosen: DirFile[] = [
		{ path: 'characters/aria/character.json', size: 4100, mtime: t(6) },
		{ path: 'content/srd/spells.csv', size: 90_000, mtime: t(8) },
		{ path: 'content/srd/backgrounds.csv', size: 3000, mtime: t(7) }
	];
	let showConflict = $state(false);

	type Notice = {
		tone: 'error' | 'warning';
		title: string;
		detail: string;
		note?: string;
	};

	const ORIGINAL_SAFE =
		"Your original folder is untouched — we didn't delete or overwrite any files there.";

	// NB: the fs reason is passed through from the OS verbatim — these samples are illustrative only, and
	// the "(os error N)" differs per platform (Windows os error 5 = Linux os error 13 for "denied").
	const cases: { label: string; notice: Notice }[] = [
		{
			label: 'Copy failed (Windows)',
			notice: {
				tone: 'error',
				title: 'Move failed',
				detail: 'Copying the files failed: failed to copy file: Access is denied. (os error 5).',
				note: ORIGINAL_SAFE
			}
		},
		{
			label: 'Copy failed (Linux)',
			notice: {
				tone: 'error',
				title: 'Move failed',
				detail: 'Copying the files failed: failed to copy file: Permission denied (os error 13).',
				note: ORIGINAL_SAFE
			}
		},
		{
			label: 'Verify mismatch',
			notice: {
				tone: 'error',
				title: 'Move failed',
				detail:
					"3 file(s) didn't copy correctly (characters/aria/character.json, content/srd/spells.csv, content/srd/species.csv…).",
				note: ORIGINAL_SAFE
			}
		},
		{
			label: 'Target inside source',
			notice: {
				tone: 'error',
				title: 'Move failed',
				detail:
					"The chosen folder is inside the current data folder, so it can't be the move target.",
				note: ORIGINAL_SAFE
			}
		},
		{
			label: 'Cleanup warning (moved, old folder left)',
			notice: {
				tone: 'warning',
				title: "Data moved, but old folder wasn't deleted",
				detail:
					"Your data was copied and verified in the new folder, but the old folder couldn't be removed: failed to remove directory: The process cannot access the file (os error 32).",
				note: 'Nothing was lost — you can delete the old folder yourself.'
			}
		}
	];

	let notice = $state<Notice | null>(null);
	let last = $state('');
	function show(c: { label: string; notice: Notice }) {
		notice = c.notice;
		last = c.label;
	}
</script>

<div class="page">
	<h1>Dev preview · Settings → Data</h1>

	<h2>The section (static copy of the desktop-only UI)</h2>
	<div class="panel">
		<section class="sec-head">
			<h3>Data location</h3>
			<p class="sec-note">
				Where Charnik keeps your characters and content on this device. Moving copies everything to
				the new folder, checks every file arrived, and only then removes the old one.
			</p>
		</section>
		<div class="setting-row">
			<span class="setting-label">Folder</span>
			<code class="mono-path">C:\Users\fern\Documents\charnik</code>
		</div>
		<div class="setting-row">
			<span class="setting-label"></span>
			<div class="setting-options">
				<button class="pill-btn">Open folder</button>
				<button class="pill-btn">Change folder…</button>
			</div>
		</div>
	</div>

	<h2>Conflict dialog — chosen folder isn't empty</h2>
	<div class="triggers">
		<button class="pill-btn" onclick={() => (showConflict = true)}>Open conflict dialog</button>
	</div>

	<h2>Migration notice dialog — each state</h2>
	<p class="last">Last opened: <code>{last || '—'}</code></p>
	<div class="triggers">
		{#each cases as c (c.label)}
			<button class="pill-btn" onclick={() => show(c)}>{c.label}</button>
		{/each}
	</div>
</div>

{#if showConflict}
	<DataConflictDialog
		rows={conflictRows(current, chosen)}
		currentPath="C:\Users\fern\Documents\charnik"
		targetPath="D:\Games\TTRPG\charnik"
		onPickAnother={() => (showConflict = false)}
		onRepoint={() => (showConflict = false)}
		onMerge={() => (showConflict = false)}
		onclose={() => (showConflict = false)}
	/>
{/if}

{#if notice}
	<DataMigrationDialog
		tone={notice.tone}
		title={notice.title}
		detail={notice.detail}
		note={notice.note}
		onclose={() => (notice = null)}
	/>
{/if}

<style>
	.page {
		padding: var(--space-6);
		max-width: 820px;
	}
	h1 {
		font-family: var(--font-display);
		color: var(--color-text);
		margin: 0 0 var(--space-5);
	}
	h2 {
		font-family: var(--font-display);
		font-size: 16px;
		color: var(--color-text);
		margin: var(--space-6) 0 var(--space-3);
	}
	.panel {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-5);
	}
	/* rows reuse the global .setting-row / .setting-label / .setting-options / .mono-path */
	.triggers {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.last {
		color: var(--color-text-muted);
	}
</style>
