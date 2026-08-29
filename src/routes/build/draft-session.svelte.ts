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

	/** Forget the current draft's identity — the next autosave starts a new file. */
	renew = () => (this.guid = crypto.randomUUID());

	/** Write the draft, or remove it once there is nothing left worth keeping. Safe to call at any
	 *  time; the page calls it debounced. */
	persist = async (): Promise<void> => {
		const host = this.host();
		if (host.isEditing) return;
		const storage = getUserStorage();
		if (!isDraftWorthKeeping(host.draft)) return deleteDraft(storage, this.guid);
		await saveDraft(storage, {
			guid: this.guid,
			savedAt: new Date().toISOString(),
			summary: draftSummary(host.draft),
			draft: $state.snapshot(host.draft),
			classPicks: [...host.classPicks],
		});
	};

	/** The draft became a character, so the unfinished copy has nothing left to be. */
	discard = (): Promise<void> => deleteDraft(getUserStorage(), this.guid);

	/** Take over a resumed record's identity. The caller restores the draft itself. */
	adopt = (record: DraftRecord) => (this.guid = record.guid);
}
