/*
 * The installed-pack REGISTRY — where each pack came from and when we last asked its repo whether
 * anything changed (docs/PLAN.md · REL-4 slice 1). Local state ABOUT an install, so it lives in app
 * config (`charnik.config.json`), never in the CSVs: a content file describes content, not this
 * machine's update habits (AI-CONVENTIONS §1.6 names this file as a legitimate exception).
 *
 * **A REPO is not a PACK.** One repository can hold several packs (the shipped SRD is two —
 * `srd-2014` and `srd-2024` — from one repo), and GitHub's tree API answers for a whole repo in a
 * single request. So the repo is the unit of CHECKING (one throttle, one `ETag`) while the pack is
 * the unit of INSTALLING (one pin, one uninstall). Modelling them as one thing would either
 * multiply requests per pack or make a pin unable to name what it pins.
 *
 * Persistence copies `sources.svelte.ts`: a JSON file in the data root through the Storage seam
 * (Tauri fs on desktop, IndexedDB on web), a pure parse over defaults, and a chained write so two
 * quick changes can't land out of order.
 */
import { getUserStorage } from '$lib/storage/provider';

/** The app-config file in the data root. Named by the architecture invariant (CLAUDE.md). */
const CONFIG_PATH = 'charnik.config.json';

/**
 * What the app may do over the NETWORK on its own. Applying is never in here — that is always a
 * user action (SECURITY.md §7), so the strongest setting still only pre-downloads.
 * Default `off`: pinging a third party on every launch contradicts the offline-first, no-account
 * posture, and PRIVACY (not rate limits) is why.
 */
export const UPDATE_MODE = {
	/** never reach the network by itself; the manual button still works */
	off: 'off',
	/** check, and say a pack has an update available */
	notify: 'notify',
	/** check and fetch the bytes ahead of time, so applying is instant — still not applied */
	download: 'download'
} as const;
export type UpdateMode = (typeof UPDATE_MODE)[keyof typeof UPDATE_MODE];

/** One installed pack: which repo it came from, and whether the user froze it. */
export interface PackEntry {
	/** The repo URL this pack was installed from — the key into `repos`. */
	repo: string;
	/** "Don't update this pack": a campaign in progress must not have its rules shift under it. */
	pinned?: boolean;
}

/** Per-REPO check state. `etag` is what makes steady state free: a `304` costs no rate-limit quota. */
export interface RepoEntry {
	/** Last `ETag` seen, replayed as `If-None-Match`. */
	etag?: string;
	/** ISO instant of the last completed check (success OR 304) — the throttle reads this. */
	lastCheckedAt?: string;
}

export interface PackConfigData {
	updates: UpdateMode;
	/** pack FOLDER name → entry. The folder is the pack (REL-4 slice 1). */
	packs: Record<string, PackEntry>;
	/** repo URL → check state. */
	repos: Record<string, RepoEntry>;
	/** Bundled packs the user deleted ON PURPOSE. Persisted because the "your rules are gone" prompt
	 *  fires at every launch, and a decision you have to re-make every launch is a nag. It suppresses
	 *  the PROMPT only — restoring stays one click in Settings. */
	dismissedMissing: string[];
}

export const emptyPackConfig = (): PackConfigData => ({
	updates: UPDATE_MODE.off,
	packs: {},
	repos: {},
	dismissedMissing: []
});

/** At most one update request per repo per day — stated plainly in the settings copy, so the
 *  number lives here and nowhere else. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Where the packs Charnik itself publishes come from. Lives here, next to the registry, because two
 * unrelated places need it and for opposite reasons: the desktop seed registers the bundled packs
 * against it, and Settings offers it as a starting point — a pack you deleted has no registry entry
 * left to read the URL off, so without this the only content the app ships would be gone for good
 * behind a URL nobody memorised.
 *
 * A constant rather than a `#content-*` header on purpose: `#content-url` already means "where the
 * DATA came from" (Wizards, for the SRD), and a file naming the repository that publishes it is a
 * self-reference to keep in sync.
 */
export const SHIPPED_PACK_REPO = 'https://github.com/FernDragonborn/charnik-content-srd';

/** Parse a stored blob over the defaults. Pure, so the merge is unit-testable without Storage; a
 *  missing/corrupt file degrades to "nothing installed, never check", never throws. */
export function parsePackConfig(raw: string | null): PackConfigData {
	if (!raw) return emptyPackConfig();
	try {
		const parsed = JSON.parse(raw) as Partial<PackConfigData>;
		return {
			updates: isUpdateMode(parsed.updates) ? parsed.updates : UPDATE_MODE.off,
			packs: isRecord(parsed.packs) ? parsed.packs : {},
			repos: isRecord(parsed.repos) ? parsed.repos : {},
			dismissedMissing: Array.isArray(parsed.dismissedMissing)
				? parsed.dismissedMissing.filter((p): p is string => typeof p === 'string')
				: []
		};
	} catch {
		return emptyPackConfig();
	}
}

const isUpdateMode = (v: unknown): v is UpdateMode => typeof v === 'string' && v in UPDATE_MODE;
const isRecord = <T>(v: unknown): v is Record<string, T> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Is this repo due for an automatic check? A MANUAL check deliberately bypasses this ("I want to
 * test this one" is the real use), so the throttle lives here and the manual path simply doesn't
 * ask. An unknown repo is always due — it has never been checked.
 */
export function isRepoDue(repo: RepoEntry | undefined, now: number): boolean {
	const last = repo?.lastCheckedAt;
	if (last === undefined) return true;
	const at = Date.parse(last);
	return Number.isNaN(at) || now - at >= CHECK_INTERVAL_MS;
}

/** Every repo that automatic checking may contact right now: the update mode allows the network,
 *  the throttle has elapsed, and at least one pack from it is NOT pinned (checking a repo whose
 *  every pack is frozen would be a request whose answer we'd refuse to use). */
export function reposDueForCheck(cfg: PackConfigData, now: number): string[] {
	const live = new Set(
		Object.values(cfg.packs)
			.filter((p) => p.pinned !== true)
			.map((p) => p.repo)
	);
	if (cfg.updates === UPDATE_MODE.off) return [];
	return [...live].filter((repo) => isRepoDue(cfg.repos[repo], now)).sort();
}

/** Reactive, persisted registry. Populated by `initPackConfig` at app start. */
export const packConfig = $state<PackConfigData>(emptyPackConfig());

function adopt(cfg: PackConfigData): void {
	packConfig.updates = cfg.updates;
	packConfig.packs = cfg.packs;
	packConfig.repos = cfg.repos;
	packConfig.dismissedMissing = cfg.dismissedMissing;
}

/**
 * Bundled packs that are NOT on disk right now — the app ships them, this install doesn't have them.
 * Recomputed at every content load and never persisted: it is a fact about the disk, not a setting.
 * Deleting a pack is allowed (it is a pack like any other), but content is what the whole app runs
 * on, so its absence is stated rather than discovered later as everything rendering empty.
 */
export const missingBundled = $state<{ packs: string[] }>({ packs: [] });

/** Which of them still deserve the launch prompt — the rest the user has already answered for. */
export const missingUnanswered = (): string[] =>
	missingBundled.packs.filter((pack) => !packConfig.dismissedMissing.includes(pack));

/** "I meant to delete it, stop asking." Suppresses the prompt for these packs; Settings still offers
 *  to restore them, because a decision is not a door that locks behind you. */
export function keepMissingPacks(packs: string[]): void {
	packConfig.dismissedMissing = [...new Set([...packConfig.dismissedMissing, ...packs])];
	persist();
}

/** A restored pack is no longer missing, so it must not stay on the "don't ask" list either — it
 *  would silence the prompt if the user deleted it again later. */
export function unDismissMissing(packs: string[]): void {
	packConfig.dismissedMissing = packConfig.dismissedMissing.filter((p) => !packs.includes(p));
	persist();
}

/** Load the registry from the data root (once, at app start). Never throws — a read failure leaves
 *  the defaults, which are "nothing installed, never check". */
export async function initPackConfig(): Promise<void> {
	let raw: string | null = null;
	try {
		raw = await getUserStorage().read(CONFIG_PATH);
	} catch {
		/* no config yet — defaults */
	}
	adopt(parsePackConfig(raw));
}

// Chained like the browse-config: whole-blob writes, stringified at execution time so the last
// write reflects the latest state, and a failure never crashes the session.
let writeChain: Promise<void> = Promise.resolve();
function persist(): void {
	writeChain = writeChain
		.catch(() => {})
		.then(() => getUserStorage().write(CONFIG_PATH, JSON.stringify(packConfig, null, 2)))
		.catch(() => {});
}

/** Record an installed pack (the installer calls this), or re-point an existing one at a new repo. */
export function registerPack(pack: string, repo: string): void {
	const existing = packConfig.packs[pack];
	packConfig.packs[pack] = existing ? { ...existing, repo } : { repo };
	packConfig.repos[repo] ??= {};
	persist();
}

/** Forget a pack (it was uninstalled). Its repo's check state is dropped once nothing uses it. */
export function forgetPack(pack: string): void {
	delete packConfig.packs[pack];
	const stillUsed = new Set(Object.values(packConfig.packs).map((p) => p.repo));
	for (const repo of Object.keys(packConfig.repos))
		if (!stillUsed.has(repo)) delete packConfig.repos[repo];
	persist();
}

/** Freeze / unfreeze a pack. */
export function setPinned(pack: string, pinned: boolean): void {
	const entry = packConfig.packs[pack];
	if (!entry) return;
	packConfig.packs[pack] = { ...entry, pinned };
	persist();
}

export function setUpdateMode(mode: UpdateMode): void {
	packConfig.updates = mode;
	persist();
}

/** Remember that we asked this repo — including a `304`, which is exactly the case worth recording
 *  (it cost nothing and means "still current"). */
export function recordCheck(repo: string, at: Date, etag?: string): void {
	const prev = packConfig.repos[repo] ?? {};
	packConfig.repos[repo] = {
		...prev,
		lastCheckedAt: at.toISOString(),
		...(etag === undefined ? {} : { etag })
	};
	persist();
}
