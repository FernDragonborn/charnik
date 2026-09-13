<script lang="ts">
	// Where Charnik keeps your data (characters + content). Shows the active folder and lets you move
	// it: pick a new location and Charnik copies everything across, verifies the copy, then removes the
	// old folder — never deleting until the copy is proven complete. If the chosen folder already has
	// files, the move is handed to the conflict dialog instead of touching anything (Stage 3).
	// Desktop-only: on the web build the browser owns storage, so this just explains that.
	import { onMount } from 'svelte';
	import { detectPlatform, Platform } from '$lib/storage/provider';
	import {
		currentDataDir,
		openDataDir,
		pickTargetDataDir,
		dirIsEmpty,
		listDataDirFiles,
		migrateDataDir,
		mergeDataDir,
		repointDataDir,
		type MigrateOutcome,
	} from '$lib/storage/tauri';
	import { conflictRows, isSameOrInside, type ConflictRow } from '$lib/storage/migrate';
	import { configWritesSettled } from '$lib/storage/json-config';
	import { errText } from '$lib/util/format';
	import { startContentWatcher, stopContentWatcher } from '$lib/content/watcher';
	import { reloadApp } from '$lib/content/reload';
	import { flashAfterReload } from '$lib/stores/flash';
	import { toast } from 'svelte-sonner';
	import { _ } from '$lib/i18n';
	import {
		characters,
		loadRoster,
		recreateDemoCharacter,
		restoreBackup,
	} from '$lib/character/store.svelte';
	import { listCharacterBackups, type CharacterBackup } from '$lib/character/repository';
	import { getUserStorage } from '$lib/storage/provider';
	import DataMigrationDialog from './DataMigrationDialog.svelte';
	import DataConflictDialog from './DataConflictDialog.svelte';
	import ConfirmDialog from '../ConfirmDialog.svelte';

	const isDesktop = detectPlatform() === Platform.Desktop;

	// The seeded demo character (Karroth) is a normal editable save — restoring rebuilds it to its
	// canonical state, wiping any edits made while playing with it. It's destructive, so it goes behind
	// a confirm. Available on web + desktop (the demo seeds first-run on both). Mirrors the /dev action.
	let confirmRestore = $state(false);
	async function restoreDemo() {
		confirmRestore = false;
		const demo = await recreateDemoCharacter();
		toast($_('settings.notice.demoRestored', { values: { name: demo.build.name } }));
	}

	/*
	 * Snapshots — the READER for the two rotating rings `repository.ts` has always written.
	 *
	 * Listed per character because that is how they are taken and how they are wanted back ("Bevan's
	 * sheet is wrong"), and lazily, on the disclosure's first open: a roster of twenty would otherwise
	 * cost twenty directory listings to render a section most visits never expand.
	 */
	let snapshots = $state<Record<string, CharacterBackup[]>>({});
	async function loadSnapshots(id: string) {
		snapshots[id] = await listCharacterBackups(getUserStorage(), id);
	}
	const snapshotWhen = (b: CharacterBackup) =>
		`${new Date(b.ts).toLocaleString()} · ${$_(
			b.tier === 'launch' ? 'settings.snapshots.tierLaunch' : 'settings.snapshots.tierSave',
		)}`;

	let confirmSnapshot = $state<{ id: string; name: string; backup: CharacterBackup } | null>(null);
	async function doRestore() {
		const asked = confirmSnapshot;
		confirmSnapshot = null;
		if (!asked) return;
		const res = await restoreBackup(asked.id, asked.backup.path);
		if (!res.ok) {
			toast(`${$_('settings.snapshots.failed')} ${res.error ?? ''}`);
			return;
		}
		// the ring moved: the restore is itself a save, so it checkpointed the state it replaced
		await loadSnapshots(asked.id);
		toast($_('settings.snapshots.done', { values: { name: asked.name } }));
	}

	// A failed move is important — it must NOT be a toast that flashes past. It goes in this persistent
	// dialog (stays until the user closes it), with a reassurance line about the original data. `then`
	// runs on close (used to reload after a move that succeeded-with-a-caveat).
	type MigrationNotice = {
		tone: 'error' | 'warning';
		title: string;
		detail: string;
		note?: string;
		then?: () => void;
	};
	let notice = $state<MigrationNotice | null>(null);
	function closeNotice() {
		const after = notice?.then;
		notice = null;
		after?.();
	}

	// The original folder is never deleted or overwritten on a failed move — say so, so the user knows
	// their data is safe and where it still is.
	const originalSafe = () => $_('settings.migrate.originalSafe');

	// When the chosen folder isn't empty an automatic move is impossible, so we open the conflict
	// dialog with a file-by-file table instead — the user picks another folder, repoints, or merges.
	let conflict = $state<{ rows: ConflictRow[]; from: string; target: string } | null>(null);

	let path = $state('…');
	let busy = $state(false);
	onMount(async () => {
		if (isDesktop) path = await currentDataDir();
		// the roster is loaded by the ROSTER page, and Settings is reachable without ever visiting it
		// (a bookmark, `?tab=data`, the update chip) — where an unloaded roster reads as "no characters"
		if (characters.roster.length === 0) await loadRoster();
	});

	// Turn a failed migrate outcome into a one-sentence "what happened". The fs reason (`outcome.error`)
	// is the technical particular and passes through untranslated — it is what the OS said.
	function moveDetail(outcome: MigrateOutcome): string {
		switch (outcome.stage) {
			case 'target_inside_source':
				return $_('settings.migrate.detailTargetInside');
			case 'copy':
				return $_('settings.migrate.detailCopy', {
					values: { error: outcome.error ?? $_('settings.migrate.unknownError') },
				});
			case 'verify':
				return $_('settings.migrate.detailVerify', {
					values: {
						count: outcome.failures.length,
						files:
							outcome.failures.slice(0, 3).join(', ') + (outcome.failures.length > 3 ? '…' : ''),
					},
				});
			default:
				return outcome.error ?? $_('settings.migrate.detailUnknown');
		}
	}

	// Shared handling for a move OR a merge outcome: a failure opens the persistent error dialog; a
	// cleanup caveat shows a warning then reloads on close; full success toasts after the reload.
	// The content watcher is stopped for the duration (deleting the old folder would fire it against
	// a vanishing tree) and resumed only when the pointer did NOT move (failure — success reloads).
	/** Every path below swaps the `Storage` root out from under the config queue, which is
	 *  fire-and-forget: a pin or an ETag written a moment ago is still queued, so it would be COPIED
	 *  in its pre-write state and then flushed against a root that no longer exists. */
	const settleBeforeSwap = () => configWritesSettled();

	async function applyOutcome(outcome: MigrateOutcome, failTitle: string, successMsg: string) {
		if (!outcome.ok) {
			startContentWatcher(); // pointer unchanged — resume watching the still-active folder
			notice = {
				tone: 'error',
				title: failTitle,
				detail: moveDetail(outcome),
				note: originalSafe(),
			};
			return;
		}
		if (outcome.stage === 'cleanup') {
			notice = {
				tone: 'warning',
				title: $_('settings.migrate.cleanupTitle'),
				detail: $_('settings.migrate.cleanupDetail', {
					values: { error: outcome.error ?? $_('settings.migrate.unknownError') },
				}),
				note: $_('settings.migrate.cleanupNote'),
				then: () => void reloadApp(),
			};
			return;
		}
		flashAfterReload(successMsg);
		await reloadApp();
	}

	// Move flow: pick a target. An EMPTY target runs the copy → verify → delete happy path; a non-empty
	// one opens the conflict dialog (never touched until the user chooses there).
	async function changeFolder() {
		if (busy) return;
		busy = true;
		try {
			const target = await pickTargetDataDir();
			if (!target) return;
			const from = await currentDataDir();
			// Picking the folder you're already in is a no-op move — refuse it with a clear heading
			// rather than "comparing" the folder against itself in the conflict dialog.
			if (isSameOrInside(target, from) && isSameOrInside(from, target)) {
				notice = {
					tone: 'error',
					title: $_('settings.migrate.sameTitle'),
					detail: $_('settings.migrate.sameDetail'),
					note: $_('settings.migrate.nothingChanged'),
				};
				return;
			}
			if (!(await dirIsEmpty(target))) {
				const [src, tgt] = await Promise.all([listDataDirFiles(from), listDataDirFiles(target)]);
				conflict = { rows: conflictRows(src, tgt), from, target };
				return;
			}
			stopContentWatcher();
			await settleBeforeSwap();
			await applyOutcome(
				await migrateDataDir(from, target, true),
				$_('settings.migrate.moveFailed'),
				$_('settings.migrate.moved'),
			);
		} catch (e) {
			startContentWatcher();
			notice = {
				tone: 'error',
				title: $_('settings.migrate.moveFailed'),
				detail: errText(e),
				note: originalSafe(),
			};
		} finally {
			busy = false;
		}
	}

	// --- conflict-dialog actions ---
	function conflictPickAnother() {
		conflict = null;
		void changeFolder(); // reopen the picker for a different (ideally empty) folder
	}
	async function conflictMerge() {
		if (!conflict || busy) return;
		const { from, target } = conflict;
		conflict = null;
		busy = true;
		try {
			stopContentWatcher();
			await settleBeforeSwap();
			await applyOutcome(
				await mergeDataDir(from, target, true),
				$_('settings.migrate.mergeFailed'),
				$_('settings.migrate.merged'),
			);
		} catch (e) {
			startContentWatcher();
			notice = {
				tone: 'error',
				title: $_('settings.migrate.mergeFailed'),
				detail: errText(e),
				note: originalSafe(),
			};
		} finally {
			busy = false;
		}
	}
	async function conflictRepoint() {
		if (!conflict || busy) return;
		const { target } = conflict;
		conflict = null;
		busy = true;
		try {
			await settleBeforeSwap();
			await repointDataDir(target);
			flashAfterReload($_('settings.migrate.repointed'));
			await reloadApp();
		} catch (e) {
			notice = {
				tone: 'error',
				title: $_('settings.migrate.repointFailed'),
				detail: errText(e),
				note: $_('settings.migrate.nothingChanged'),
			};
		} finally {
			busy = false;
		}
	}
</script>

<section class="sec-head">
	<h2>{$_('settings.storage.title')}</h2>
	<p class="sec-note">{$_('settings.storage.blurb')}</p>
</section>

{#if isDesktop}
	<div class="setting-row">
		<span class="setting-label">{$_('settings.storage.folder')}</span>
		<code class="mono-path" title={path}>{path}</code>
	</div>
	<div class="setting-row">
		<span class="setting-label"></span>
		<div class="setting-options">
			<button class="pill-btn" onclick={openDataDir} disabled={busy}
				>{$_('settings.storage.open')}</button
			>
			<button class="pill-btn" onclick={changeFolder} disabled={busy}
				>{$_('settings.storage.change')}</button
			>
		</div>
	</div>
{:else}
	<p class="sec-note">{$_('settings.storage.webNote')}</p>
{/if}

<section class="sec-head">
	<h2>{$_('settings.demo.title')}</h2>
	<p class="sec-note">{$_('settings.demo.blurb')}</p>
</section>
<div class="setting-row">
	<span class="setting-label"></span>
	<div class="setting-options">
		<button class="pill-btn" onclick={() => (confirmRestore = true)}
			>{$_('settings.demo.restore')}</button
		>
	</div>
</div>

<section class="sec-head">
	<h2>{$_('settings.snapshots.title')}</h2>
	<p class="sec-note">{$_('settings.snapshots.blurb')}</p>
</section>
{#if characters.roster.length === 0}
	<p class="sec-note">{$_('settings.snapshots.empty')}</p>
{:else}
	{#each characters.roster as entry (entry.id)}
		<details class="snap" ontoggle={() => void loadSnapshots(entry.id)}>
			<summary>{entry.name}</summary>
			{#if snapshots[entry.id]?.length}
				<ul class="snap-list">
					{#each snapshots[entry.id] ?? [] as backup (backup.path)}
						<li>
							<span class="snap-when">{snapshotWhen(backup)}</span>
							<button
								class="pill-btn"
								onclick={() => (confirmSnapshot = { id: entry.id, name: entry.name, backup })}
								>{$_('settings.snapshots.restore')}</button
							>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="sec-note">{$_('settings.snapshots.none')}</p>
			{/if}
		</details>
	{/each}
{/if}

{#if confirmSnapshot}
	<ConfirmDialog
		title={$_('settings.snapshots.confirmTitle', { values: { name: confirmSnapshot.name } })}
		message={$_('settings.snapshots.confirmBody', {
			values: { when: snapshotWhen(confirmSnapshot.backup) },
		})}
		confirmLabel={$_('settings.snapshots.confirmAction')}
		danger
		onConfirm={doRestore}
		onCancel={() => (confirmSnapshot = null)}
	/>
{/if}

{#if confirmRestore}
	<ConfirmDialog
		title={$_('settings.demo.confirmTitle')}
		message={$_('settings.demo.confirmBody')}
		confirmLabel={$_('settings.demo.confirmAction')}
		danger
		onConfirm={restoreDemo}
		onCancel={() => (confirmRestore = false)}
	/>
{/if}

{#if conflict}
	<DataConflictDialog
		rows={conflict.rows}
		currentPath={conflict.from}
		targetPath={conflict.target}
		onPickAnother={conflictPickAnother}
		onRepoint={conflictRepoint}
		onMerge={conflictMerge}
		onclose={() => (conflict = null)}
	/>
{/if}

{#if notice}
	<DataMigrationDialog
		tone={notice.tone}
		title={notice.title}
		detail={notice.detail}
		note={notice.note}
		onclose={closeNotice}
	/>
{/if}

<style>
	/* one disclosure per character: the list is per character, and a flat roster-wide list would make
	   "which sheet is this" the reader's problem */
	.snap {
		margin: 0 0 var(--space-2);
	}
	.snap summary {
		cursor: pointer;
		padding: var(--space-1) 0;
		color: var(--color-text);
	}
	.snap-list {
		list-style: none;
		margin: var(--space-1) 0 var(--space-2);
		padding: 0 0 0 var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-1-5);
	}
	/* a grid, not a flex row: the timestamps differ in width and the Restore buttons under each other
	   are what the eye scans down */
	.snap-list li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-3);
		max-width: 360px;
	}
	.snap-when {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	/* rows use the global .setting-row / .setting-label / .setting-options / .mono-path
	   (components.css) */
</style>
