/*
 * Startup content-review state (DATA-VER-1). The loader surfaces two things on the graph:
 * `metaIssues` (files missing required metadata) and `driftItems` (files whose body no longer matches
 * their recorded hash). The layout mounts the two review modals; this store tracks per-session
 * dismissal so a "Skip"/"Don't ask" closes them without re-popping on every navigation. The actual
 * write-back lives in the provider (task 6); these flags only gate visibility.
 */
import { content } from './store.svelte';

export const review = $state<{ metaDismissed: boolean; driftDismissed: boolean }>({
	metaDismissed: false,
	driftDismissed: false
});

/** Files needing a metadata prompt, unless dismissed this session. */
export function pendingMetaIssues() {
	return review.metaDismissed ? [] : (content.graph?.metaIssues ?? []);
}
/** Drifted files needing a date/hash bump, unless dismissed this session. */
export function pendingDriftItems() {
	return review.driftDismissed ? [] : (content.graph?.driftItems ?? []);
}
