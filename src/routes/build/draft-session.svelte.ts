/*
 * The unfinished build as a thing that outlives the tab.
 *
 * Split from BuildVM because it is the only part of the builder that touches storage, and because
 * the view-model is at its line budget. The host is declared structurally (like InspectorHost next
 * door) so the two modules stay acyclic.
 */
import { getUserStorage } from '$lib/storage/provider';
import { saveDraft, deleteDraft, type DraftRecord } from '$lib/character/draft-repository';
import { draftSummary, isDraftWorthKeeping, type DraftState } from './draft';
import type { ClassScopedPicks } from './class-picks-cache';

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
	 * The builder's option preview derives the sheet on a TRIAL draft and puts the draft back, which
	 * replaces the `$state` object twice — so merely reading what a class would do wakes the autosave
	 * with nothing to save. Without this, a player browsing options rewrites the same file on disk
	 * over and over. Compared by value because the draft is plain data.
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
		if (!isDraftWorthKeeping(host.draft)) {
			this.written = null;
			return deleteDraft(storage, this.guid);
		}
		const snapshot = $state.snapshot(host.draft);
		const body = JSON.stringify([snapshot, [...host.classPicks]]);
		if (body === this.written) return;
		this.written = body;
		await saveDraft(storage, {
			guid: this.guid,
			savedAt: new Date().toISOString(),
			summary: draftSummary(host.draft),
			draft: snapshot,
			classPicks: [...host.classPicks],
		});
	};

	/** The draft became a character, so the unfinished copy has nothing left to be. */
	discard = (): Promise<void> => deleteDraft(getUserStorage(), this.guid);

	/** Take over a resumed record's identity. The caller restores the draft itself. */
	adopt = (record: DraftRecord) => {
		this.guid = record.guid;
		this.written = null;
	};
}
