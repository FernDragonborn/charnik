/*
 * Startup content-review state + write-back (DATA-VER-1, task 6). The loader surfaces two things on
 * the graph: `metaIssues` (files missing required metadata) and `driftItems` (files whose body no
 * longer matches their recorded hash). The layout mounts the two review modals; this module decides
 * when they are shown and performs what their confirm buttons promise.
 *
 * DESKTOP ONLY, deliberately. On the web build the content is served read-only over fetch, so there
 * is nothing to write back to — the loader still DETECTS both conditions and the content-health panel
 * still lists them, but a prompt whose only button cannot work is worse than no prompt.
 */
import { app } from '$lib/stores/app.svelte';
import { detectPlatform, getUserStorage, Platform } from '$lib/storage/provider';
import type { FilledMeta } from './meta';
import type { ContentType } from './schemas';
import { isPackWriteInFlight } from './remote/install';
import { restampFiles, type RestampFailure } from './restamp';
import { content, reloadContent } from './store.svelte';

export const review = $state<{ metaDismissed: boolean; driftDismissed: boolean }>({
	metaDismissed: false,
	driftDismissed: false,
});

/** Can this build fix a content file at all? Gates every prompt below (see the module note). */
const canWriteContent = (): boolean => detectPlatform() === Platform.Desktop;

/** Files needing a metadata prompt, unless dismissed this session or muted for good. */
export function pendingMetaIssues() {
	if (review.metaDismissed || app.contentEditingMode || !canWriteContent()) return [];
	return content.graph?.metaIssues ?? [];
}
/** Drifted files needing a date/hash bump. In content-editing mode they are adopted without asking
 *  ({@link autoAdoptDrift}), so there is nothing left to prompt about. */
export function pendingDriftItems() {
	if (review.driftDismissed || app.contentEditingMode || !canWriteContent()) return [];
	return content.graph?.driftItems ?? [];
}

const today = (): string => new Date().toISOString().slice(0, 10);

/** Re-stamp the chosen drifted files and rebuild the graph. A hand-edit is a data change, so the
 *  declared revision date moves with the hash — that is what the dialog offers. */
export async function adoptDriftedFiles(files: readonly string[]): Promise<RestampFailure[]> {
	const stamp = today();
	const sets: FilledMeta = Object.fromEntries(files.map((f) => [f, { updated_at: stamp }]));
	const failures = await restampFiles(getUserStorage(), files, sets);
	await reloadContent();
	return failures;
}

/** Write the metadata the user supplied into each file's header. The revision date is NOT bumped:
 *  filling in a license is not a change to the DATA, and that date means "when the author last said
 *  the data moved". */
export async function fillMissingMeta(fills: FilledMeta): Promise<RestampFailure[]> {
	// The dialog hands back an entry per FILE it showed, including ones the user scrolled past and
	// left blank. Writing those achieves nothing (the file is only in the list because a human key is
	// missing, and it still would be) while changing bytes the pack differ compares — so the next
	// update would offer to re-download a file whose content never moved.
	const filled = Object.keys(fills).filter((file) =>
		Object.values(fills[file] ?? {}).some((v) => v !== undefined && v !== ''),
	);
	const failures = await restampFiles(getUserStorage(), filled, fills);
	await reloadContent();
	return failures;
}

/**
 * Tell a file what content type it holds: write `#content-type:` into its header and reload.
 *
 * The one fix for a file the loader could not place — a hand-named CSV, or one naming a type this
 * build does not know — and the reason it belongs in the app at all is that the alternative is
 * "open the file and add a line", which is the thing Charnik promises you never have to do.
 */
export async function assignFileType(file: string, type: ContentType): Promise<RestampFailure[]> {
	const failures = await restampFiles(getUserStorage(), [file], { [file]: { type } });
	await reloadContent();
	return failures;
}

/** Re-entrancy guard: adopting WRITES, the watcher sees those writes and reloads, and that reload
 *  calls back in here. The empty-drift check below is what actually terminates the cycle (the files
 *  just stamped no longer drift); this only stops a debounced reload from landing mid-batch. */
let adopting = false;

/**
 * Content-editing mode: the author is editing CSVs on disk right now and does not want a dialog on
 * every reload, so a drifted file is adopted silently. Called after each content load (startup and
 * the file watcher), never from `reloadContent` itself — that would be an import cycle.
 *
 * Failures are deliberately not raised: nobody asked for this write at this moment, and losing it
 * costs nothing — the file simply stays drifted, stays listed in content health, and is retried on
 * the next load.
 */
export async function autoAdoptDrift(): Promise<void> {
	if (adopting || !app.contentEditingMode || !canWriteContent()) return;
	// Never write into a pack that is being swapped: an apply re-checks every file's disk state right
	// before the rename and refuses the whole update if anything moved, so an unattended stamp landing
	// mid-swap would cancel a user's update with a reason they could not connect to anything.
	if (isPackWriteInFlight()) return;
	const files = (content.graph?.driftItems ?? []).map((d) => d.file);
	if (files.length === 0) return;
	adopting = true;
	try {
		await adoptDriftedFiles(files);
	} finally {
		adopting = false;
	}
}
