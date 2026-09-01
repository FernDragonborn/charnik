/*
 * The unfinished build as a thing that outlives the tab.
 *
 * Split from BuildVM because it is the only part of the builder that touches storage, and because
 * the view-model is at its line budget. The host is declared structurally (like InspectorHost next
 * door) so the two modules stay acyclic.
 */
import { toast } from 'svelte-sonner';
import { t } from '$lib/i18n';
import { getUserStorage } from '$lib/storage/provider';
import { saveDraft, deleteDraft, type DraftRecord } from '$lib/character/draft-repository';
import { draftSummary, isDraftWorthKeeping, type DraftState } from './draft';
import type { ClassScopedPicks } from './class-picks-cache';

/** One id for the autosave failure, so a disk that stays full replaces its notice instead of
 *  stacking one per settled keystroke. */
const DRAFT_SAVE_FAILED_TOAST = 'build-draft-save-failed';

/** What this needs from the view-model around it. */
export interface DraftSessionHost {
	draft: DraftState;
	classPicks: Map<string, ClassScopedPicks>;
	/** Editing a real character — its own save is the record, so no draft file is written. */
	isEditing: boolean;
}

export class DraftSession {
	constructor(private host: () => DraftSessionHost) {}

	/** Identity of the unfinished build on disk. A GUID because a draft has no name to be keyed by
	 *  and may never get one (AGENTS.md: identify anything shareable with a GUID). */
	guid = $state<string>(crypto.randomUUID());

	/**
	 * What was last written, so an unchanged draft is not written again.
	 *
	 * The autosave subscribes by snapshotting the whole draft, so anything that REPLACES the `$state`
	 * object — an undo, a redo, resuming the same record — wakes it with nothing new to save. Without
	 * this, that rewrites the same file on disk over and over. Compared by value: the draft is plain
	 * data.
	 */
	private written: string | null = null;

	/** Forget the current draft's identity — the next autosave starts a new file. */
	renew = () => {
		this.guid = crypto.randomUUID();
		this.written = null; // a new file has nothing written to it yet
	};

	/** Write the draft, or remove it once there is nothing left worth keeping. Safe to call at any
	 *  time; the page calls it debounced. */
	persist = async (): Promise<void> => {
		const host = this.host();
		if (host.isEditing) return;
		const storage = getUserStorage();
		try {
			if (!isDraftWorthKeeping(host.draft)) {
				await deleteDraft(storage, this.guid);
				this.written = null;
				return;
			}
			const snapshot = $state.snapshot(host.draft);
			const body = JSON.stringify([snapshot, [...host.classPicks]]);
			if (body === this.written) return;
			await saveDraft(storage, {
				guid: this.guid,
				savedAt: new Date().toISOString(),
				summary: draftSummary(host.draft),
				draft: snapshot,
				classPicks: [...host.classPicks],
			});
			// recorded only once the write RETURNED. Claiming it beforehand meant a full disk or a
			// renamed folder left `written` describing a file that does not exist, and every identical
			// autosave after it short-circuited — the draft was never written again and never retried.
			this.written = body;
		} catch {
			// Swallowed on purpose: the page calls this from a debounce as `void persist()`, so a
			// rejection escaping here is an unhandled promise rejection nobody sees — the exact loss the
			// autosave exists to prevent. Forgetting `written` is what makes the next change retry.
			this.written = null;
			toast(t('build.notice.draftNotSaved'), {
				id: DRAFT_SAVE_FAILED_TOAST, // one standing notice, not one per keystroke
				description: t('build.notice.draftNotSavedBody'),
			});
		}
	};

	/** The draft became a character, so the unfinished copy has nothing left to be. */
	discard = (): Promise<void> => deleteDraft(getUserStorage(), this.guid);

	/** Take over a resumed record's identity. The caller restores the draft itself. */
	adopt = (record: DraftRecord) => {
		this.guid = record.guid;
		this.written = null;
	};
}
