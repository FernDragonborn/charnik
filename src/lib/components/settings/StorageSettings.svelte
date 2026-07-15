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
		type MigrateOutcome
	} from '$lib/storage/tauri';
	import { conflictRows, isSameOrInside, type ConflictRow } from '$lib/storage/migrate';
	import { startContentWatcher, stopContentWatcher } from '$lib/content/watcher';
	import { reloadApp } from '$lib/content/reload';
	import { flashAfterReload } from '$lib/stores/flash';
	import DataMigrationDialog from './DataMigrationDialog.svelte';
	import DataConflictDialog from './DataConflictDialog.svelte';

	const isDesktop = detectPlatform() === Platform.Desktop;

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
	const ORIGINAL_SAFE =
		"Your original folder is untouched — we didn't delete or overwrite any files there.";
	const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

	// When the chosen folder isn't empty an automatic move is impossible, so we open the conflict
	// dialog with a file-by-file table instead — the user picks another folder, repoints, or merges.
	let conflict = $state<{ rows: ConflictRow[]; from: string; target: string } | null>(null);

	let path = $state('…');
	let busy = $state(false);
	onMount(async () => {
		if (isDesktop) path = await currentDataDir();
	});

	// Turn a failed migrate outcome into a one-sentence "what happened".
	function moveDetail(outcome: MigrateOutcome): string {
		switch (outcome.stage) {
			case 'target-inside-source':
				return "The chosen folder is inside the current data folder, so it can't be the move target.";
			case 'copy':
				return `Copying the files failed: ${outcome.error ?? 'unknown error'}.`;
			case 'verify':
				return `${outcome.failures.length} file(s) didn't copy correctly (${outcome.failures
					.slice(0, 3)
					.join(', ')}${outcome.failures.length > 3 ? '…' : ''}).`;
			default:
				return outcome.error ?? 'Unknown error.';
		}
	}

	// Shared handling for a move OR a merge outcome: a failure opens the persistent error dialog; a
	// cleanup caveat shows a warning then reloads on close; full success toasts after the reload.
	// The content watcher is stopped for the duration (deleting the old folder would fire it against
	// a vanishing tree) and resumed only when the pointer did NOT move (failure — success reloads).
	async function applyOutcome(outcome: MigrateOutcome, failTitle: string, successMsg: string) {
		if (!outcome.ok) {
			startContentWatcher(); // pointer unchanged — resume watching the still-active folder
			notice = {
				tone: 'error',
				title: failTitle,
				detail: moveDetail(outcome),
				note: ORIGINAL_SAFE
			};
			return;
		}
		if (outcome.stage === 'cleanup') {
			notice = {
				tone: 'warning',
				title: "Data moved, but old folder wasn't deleted",
				detail: `Your data was copied and verified in the new folder, but the old folder couldn't be removed: ${outcome.error ?? 'unknown error'}.`,
				note: 'Nothing was lost — you can delete the old folder yourself.',
				then: () => void reloadApp()
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
					title: "That's already your data folder",
					detail:
						"You can't move your data into the folder it already lives in — pick a different one.",
					note: 'Nothing was changed.'
				};
				return;
			}
			if (!(await dirIsEmpty(target))) {
				const [src, tgt] = await Promise.all([listDataDirFiles(from), listDataDirFiles(target)]);
				conflict = { rows: conflictRows(src, tgt), from, target };
				return;
			}
			stopContentWatcher();
			await applyOutcome(
				await migrateDataDir(from, target, true),
				'Move failed',
				'Data moved successfully'
			);
		} catch (e) {
			startContentWatcher();
			notice = { tone: 'error', title: 'Move failed', detail: errText(e), note: ORIGINAL_SAFE };
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
			await applyOutcome(
				await mergeDataDir(from, target, true),
				'Merge failed',
				'Data merged successfully'
			);
		} catch (e) {
			startContentWatcher();
			notice = { tone: 'error', title: 'Merge failed', detail: errText(e), note: ORIGINAL_SAFE };
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
			await repointDataDir(target);
			flashAfterReload('Now reading from the new folder');
			await reloadApp();
		} catch (e) {
			notice = {
				tone: 'error',
				title: "Couldn't change the read path",
				detail: errText(e),
				note: 'Nothing was changed.'
			};
		} finally {
			busy = false;
		}
	}
</script>

<section class="sec-head">
	<h2>Data location</h2>
	<p class="sec-note">
		Where Charnik keeps your characters and content on this device. Moving copies everything to the
		new folder, checks every file arrived, and only then removes the old one.
	</p>
</section>

{#if isDesktop}
	<div class="setting-row">
		<span class="setting-label">Folder</span>
		<code class="mono-path" title={path}>{path}</code>
	</div>
	<div class="setting-row">
		<span class="setting-label"></span>
		<div class="setting-options">
			<button class="pill-btn" onclick={openDataDir} disabled={busy}>Open folder</button>
			<button class="pill-btn" onclick={changeFolder} disabled={busy}>Change folder…</button>
		</div>
	</div>
{:else}
	<p class="sec-note">
		On the web version your data lives in this browser's storage — there's no folder to move. Use
		Export to take a copy with you.
	</p>
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
	/* rows use the global .setting-row / .setting-label / .setting-options / .mono-path
	   (components.css) */
</style>
