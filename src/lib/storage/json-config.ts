/*
 * A JSON config FILE in the data root that has SEVERAL owners.
 *
 * `charnik.config.json` is the app config (docs/PLAN.md "Config files": dataDir, roots, toggles,
 * rule-options, settings) — the pack registry is one section of it, not the file. The obvious
 * implementation, `write(JSON.stringify(myState))`, quietly makes the first writer the file's owner
 * and every later one a data-loss bug: pinning a pack would drop rule-options it never knew about,
 * with no error anywhere. So a writer here owns exactly ONE top-level KEY — the write is
 * read-merge-write, and unknown keys survive it untouched.
 *
 * The write queue is per FILE, not per module: two sections written at the same moment would both
 * read the pre-state and the second would erase the first (lost update). Different files never wait
 * on each other. Values are stringified at EXECUTION time, so a queued write always persists the
 * latest state of a reactive `$state` object rather than a stale snapshot.
 */
import { getUserStorage } from './provider';

/** The whole file as a plain object — `{}` when it is missing, unreadable, or not a JSON object.
 *  Never throws: a corrupt config degrades to defaults, which every section parser already handles. */
export async function readConfigFile(file: string): Promise<Record<string, unknown>> {
	try {
		const parsed: unknown = JSON.parse(await getUserStorage().read(file));
		return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

/** One section, or `undefined` when absent. */
export async function readConfigSection(file: string, key: string): Promise<unknown> {
	return (await readConfigFile(file))[key];
}

const chains = new Map<string, Promise<void>>();
/** Sections written since the last flush was queued and before it started — see below. */
const dirty = new Map<string, Map<string, unknown>>();

/**
 * Replace one section, preserving every other key in the file. Fire-and-forget (queued); a write
 * failure never crashes the session or surfaces as an unhandled rejection — the change simply
 * isn't saved, which is the same posture the rest of the config layer takes.
 *
 * **Calls made before the queued flush starts COALESCE into it.** The natural way to call this is
 * once per changed thing, and the callers do exactly that: reconciling the pack registry against the
 * disk forgets each uninstalled pack and adopts each bundled one, so every content load used to
 * read-merge-write `charnik.config.json` a dozen times over to persist one final state. The value is
 * read at EXECUTION time, so all of those writes were already producing identical bytes — collapsing
 * them changes nothing but the number of times the file is rewritten. Different sections written in
 * the same tick merge into the one write too, which is the case the per-file chain existed for.
 */
export function writeConfigSection(file: string, key: string, value: unknown): void {
	const queued = dirty.get(file);
	if (queued) {
		queued.set(key, value); // a flush is already scheduled and will pick this up
		return;
	}
	dirty.set(file, new Map([[key, value]]));
	const next = (chains.get(file) ?? Promise.resolve())
		.catch(() => {})
		.then(async () => {
			// taken BEFORE the first await, so anything written from here on schedules its own flush
			// rather than riding on one that may already have read the file
			const sections = dirty.get(file) ?? new Map<string, unknown>();
			dirty.delete(file);
			const merged = { ...(await readConfigFile(file)) };
			for (const [k, v] of sections) merged[k] = v;
			await getUserStorage().write(file, JSON.stringify(merged, null, 2));
		})
		.catch(() => {});
	chains.set(file, next);
}

/** Resolves when every queued write for this file has landed. For the callers that must not race
 *  the queue — a data-folder move (which swaps the Storage under it) and the tests. */
export function configWritesSettled(file: string): Promise<void> {
	return chains.get(file) ?? Promise.resolve();
}
