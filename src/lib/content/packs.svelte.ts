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
 * Persistence: a pure parse over defaults, plus ONE SECTION of the shared app-config file
 * (`storage/json-config.ts`). The registry is a tenant of that file, not its owner — writing the
 * whole blob would erase every other section (rule-options, settings) the moment a pack is pinned.
 */
import { errText } from '../util/format';
import { readConfigFile, writeConfigSection } from '$lib/storage/json-config';
import { HOMEBREW_ROOT } from './homebrew';

/** The app-config file in the data root. Named by the architecture invariant (CLAUDE.md). */
const CONFIG_PATH = 'charnik.config.json';
/** Our top-level key inside it. Deliberately NOT `packs` — that name is already taken one level
 *  down (`PackConfigData.packs`), and a section whose name shadows one of its own fields is a trap
 *  for both the reader and the legacy-shape check in `initPackConfig`. */
const SECTION = 'contentPacks';

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
	download: 'download',
} as const;
export type UpdateMode = (typeof UPDATE_MODE)[keyof typeof UPDATE_MODE];

/** One installed pack: which repo it came from, and whether the user froze it. */
export interface PackEntry {
	/** The repo URL this pack was installed from — the key into `repos`. */
	repo: string;
	/** "Don't update this pack": a campaign in progress must not have its rules shift under it. */
	pinned?: boolean;
	/**
	 * The folder name this pack has IN ITS REPO, when that differs from the folder it lives in here.
	 *
	 * A pack is a folder, and folder names are not the publisher's to reserve: two repos may both
	 * offer `srd-2024`, and one of them has to live somewhere else on disk. So the local folder is
	 * the identity everywhere in the app (it is what `content/` scanning finds, what a character's
	 * rows are attributed to, and what a pin names), and this records what to ask the repo for.
	 *
	 * Absent means the two agree, which is the normal case and what every pre-existing entry says —
	 * so nothing migrates.
	 */
	remotePack?: string;
}

/** What this pack is CALLED in its repo — the path prefix the remote listing uses. */
export const remoteNameOf = (pack: string, entry: PackEntry): string => entry.remotePack ?? pack;

/** Per-REPO check state. `etag` is what makes steady state free: a `304` costs no rate-limit quota. */
export interface RepoEntry {
	/** Last `ETag` seen, replayed as `If-None-Match`. */
	etag?: string;
	/** ISO instant of the last completed check (success OR 304) — the throttle reads this. */
	lastCheckedAt?: string;
	/**
	 * The branch the tree listing actually came off, when it isn't the one the URL implies.
	 *
	 * A URL without `/tree/<branch>` is a guess (`main`), and the guess is wrong for every repo still
	 * on `master`. Resolving it at check time is not enough: the file downloads that follow are a
	 * SEPARATE host (`raw.githubusercontent.com`) built from the same URL, and a restart rebuilds the
	 * pending offer from this file with no network at all — so the answer has to be remembered here,
	 * or every byte of the apply 404s on a branch nobody asked for.
	 */
	branch?: string;
}

/**
 * An update that was FOUND and not yet applied, in the smallest form that survives a restart: the
 * remote file list. Everything the panel shows is derived from it against the local disk, so a
 * relaunch rebuilds the whole picture with no network at all.
 *
 * **Why it must be persisted.** The `ETag` is recorded the moment a repo answers, and it means "I
 * have seen this remote state" — but the pending set lived only in memory. So: find an update,
 * close the app, relaunch → the check replays the `ETag`, gets `304`, returns before it ever looks
 * at the pack, and the update is invisible until some LATER upstream commit changes the tree again.
 * Nothing recovered it, not even the manual button. Keeping the file list is what makes the two
 * halves agree about what "already seen" means.
 */
export interface PendingRemote {
	repo: string;
	files: { path: string; sha: string }[];
}

export interface PackConfigData {
	updates: UpdateMode;
	/** pack FOLDER name → entry. The folder is the pack (REL-4 slice 1). */
	packs: Record<string, PackEntry>;
	/** repo URL → check state. */
	repos: Record<string, RepoEntry>;
	/** pack → an update found and not yet applied. */
	pending: Record<string, PendingRemote>;
	/** Bundled packs the user deleted ON PURPOSE. Persisted because the "your rules are gone" prompt
	 *  fires at every launch, and a decision you have to re-make every launch is a nag. It suppresses
	 *  the PROMPT only — restoring stays one click in Settings. */
	dismissedMissing: string[];
}

export const emptyPackConfig = (): PackConfigData => ({
	updates: UPDATE_MODE.off,
	packs: {},
	repos: {},
	pending: {},
	dismissedMissing: [],
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

/**
 * Folder names under `content/` that a remote pack may NOT claim.
 *
 * "A pack is a folder" is the whole model, and it has no exceptions anywhere else — so every folder
 * we treat specially has to be defended HERE rather than filtered in the one place that happens to
 * know about it. `homebrew` is the sharp one: it is the user's own authoring root, so a repo
 * publishing a folder by that name would install straight into it, and uninstalling "that pack"
 * would delete everything the user ever wrote. The update staging folders are reserved for the
 * opposite reason — they exist for milliseconds during an apply, and a content load that caught
 * them mid-swap would load every row twice.
 *
 * Compared case-INSENSITIVELY: on Windows `Homebrew/` and `homebrew/` are the same folder, so a
 * case-sensitive check would be a bypass rather than a check.
 */
const RESERVED_PACK_NAMES = new Set([HOMEBREW_ROOT.slice(HOMEBREW_ROOT.lastIndexOf('/') + 1)]);
/** Staging suffixes used by an apply (`<pack>.new` → swap → `<pack>.prev`). */
const STAGING_SUFFIX = /\.(new|prev)$/i;

export function isReservedPackName(pack: string): boolean {
	const name = pack.toLowerCase();
	// a leading dot is ours by convention (`.seed-version`, `.pack-cache`) — never an installable pack
	return name.startsWith('.') || STAGING_SUFFIX.test(name) || RESERVED_PACK_NAMES.has(name);
}

/**
 * Shapes a folder name cannot have, on top of the names we reserve.
 *
 * A separator would NEST the pack rather than name it — and `\` is the quiet one, because the
 * Storage seam normalises it before splitting, so `a\b` becomes a subfolder instead of an error. The
 * rest are refused by Windows itself, which is the problem: the refusal arrives as a throw from
 * `mkdir` in the middle of a swap, where the pack folder has already been renamed away, instead of
 * as a message before anything moved.
 */
const ILLEGAL_CHAR = /[\\/:*?"<>|]/;
/** A trailing dot or space is the quiet one: Windows strips it, so `srd ` and `srd` would be one
 *  folder wearing two registry entries. */
const TRAILING_DOT_OR_SPACE = /[. ]$/;
/** …and the DOS device names, which Windows still refuses as directory names, with or without an
 *  extension (`nul`, `nul.csv`). */
const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
/** …and any control character, which no filesystem wants in a name and every UI mis-renders.
 *  Tested by code point rather than a regex range, so the escape can't be flattened into a raw byte
 *  by anything editing this file. */
const hasControlChar = (name: string): boolean => [...name].some((c) => c.charCodeAt(0) < 32);

/** Can a pack be installed into a folder of this name? The ONE gate — install and rename both ask
 *  it, so a name that is refused in one place cannot be accepted in the other. */
export function isUsablePackFolderName(name: string): boolean {
	if (name === '' || ILLEGAL_CHAR.test(name) || TRAILING_DOT_OR_SPACE.test(name)) return false;
	if (hasControlChar(name) || DEVICE_NAME.test(name.split('.')[0] ?? '')) return false;
	return !isReservedPackName(name);
}

/**
 * A folder name the app can actually create, derived from one it cannot.
 *
 * Publishers do not owe us Windows-safe folder names, and refusing such a pack outright would hide
 * it from the install list with no way to say why. Correcting the name and letting the user overrule
 * the suggestion is the same shape as the `-2` collision path right below.
 *
 * It must also TERMINATE that path: `freeLocalPackName` suffixes `-2`, `-3`… until a name is free,
 * and a base that is unusable for its CHARACTERS stays unusable however many suffixes it gets — so
 * without this the loop would spin forever on `foo:bar` or `.git`.
 */
export function sanitisePackFolderName(name: string): string {
	const cleaned = [...name]
		.map((c) => (ILLEGAL_CHAR.test(c) || c.charCodeAt(0) < 32 ? '-' : c))
		.join('')
		.replace(/^\.+/, '') // a leading dot is ours by convention, and no suffix ever clears it
		.replace(/[. ]+$/, '')
		.trim();
	// a name that is STILL unusable can only be reserved or a device name, both of which a prefix
	// settles — and `pack` alone covers a name that sanitised down to nothing
	return isUsablePackFolderName(cleaned) ? cleaned : `pack${cleaned === '' ? '' : `-${cleaned}`}`;
}

/**
 * The registry key that already OWNS this folder name, compared the way the filesystem compares it.
 *
 * NTFS and APFS fold case, so `SRD-2024` and `srd-2024` are one directory — and an exact-string
 * lookup answering "free" is how a stranger's pack ends up installed ON TOP of one the user already
 * had: the diff reads the other pack's files, and the swap renames it away to `.prev`.
 */
export const claimedPackName = (name: string): string | undefined =>
	Object.keys(packConfig.packs).find((pack) => pack.toLowerCase() === name.toLowerCase());

/** Parse a stored section over the defaults. Pure, so the merge is unit-testable without Storage;
 *  anything that isn't a well-formed section degrades to "nothing installed, never check". */
export function parsePackConfig(raw: unknown): PackConfigData {
	if (!isRecord<unknown>(raw)) return emptyPackConfig();
	const parsed = raw as Partial<PackConfigData>;
	return {
		updates: isUpdateMode(parsed.updates) ? parsed.updates : UPDATE_MODE.off,
		packs: isRecord(parsed.packs) ? parsed.packs : {},
		repos: isRecord(parsed.repos) ? parsed.repos : {},
		pending: parsePending(parsed.pending),
		dismissedMissing: Array.isArray(parsed.dismissedMissing)
			? parsed.dismissedMissing.filter((p): p is string => typeof p === 'string')
			: [],
	};
}

/** A remembered update drives what we OVERWRITE on disk, so it is validated field by field rather
 *  than trusted for being in our own file — a half-written or hand-edited entry is dropped, not
 *  half-believed. (`sha` absent is meaningful elsewhere in the diff; here it is malformed.) */
function parsePending(raw: unknown): Record<string, PendingRemote> {
	if (!isRecord<unknown>(raw)) return {};
	const out: Record<string, PendingRemote> = {};
	for (const [pack, value] of Object.entries(raw)) {
		if (!isRecord<unknown>(value)) continue;
		const { repo, files } = value as Partial<PendingRemote>;
		if (typeof repo !== 'string' || !Array.isArray(files)) continue;
		const clean = files.filter(
			(f): f is { path: string; sha: string } =>
				isRecord<unknown>(f) && typeof f.path === 'string' && typeof f.sha === 'string',
		);
		if (clean.length === files.length) out[pack] = { repo, files: clean };
	}
	return out;
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
			.map((p) => p.repo),
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
	packConfig.pending = cfg.pending;
	packConfig.dismissedMissing = cfg.dismissedMissing;
}

/**
 * Bundled packs that are NOT on disk right now — the app ships them, this install doesn't have them.
 * Recomputed at every content load and never persisted: it is a fact about the disk, not a setting.
 * Deleting a pack is allowed (it is a pack like any other), but content is what the whole app runs
 * on, so its absence is stated rather than discovered later as everything rendering empty.
 */
export const missingBundled = $state<{ packs: string[] }>({ packs: [] });

/**
 * The packs the APP SHIPS, by the folder name it ships them under. Recomputed at every content load
 * from the bundle itself, never persisted — it is a fact about this build.
 *
 * It exists because a bundled pack is identified by that folder name and by nothing else: the seed
 * refreshes `content/<name>`, `missingBundled` is "the bundle has it and the disk doesn't", and the
 * restore button copies it back to the same place. So the folder is not free to move the way a
 * downloaded pack's is, and `renamePack` needs to know which packs those are in order to say so.
 */
export const bundledPacks = $state<{ packs: string[] }>({ packs: [] });

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
	const cfg = await readConfigFile(CONFIG_PATH);
	// The pre-sections layout, where the registry owned the whole file (REL-4 dev builds). Detected
	// by a field only the registry ever wrote at top level; drop this once a release has shipped.
	const legacy = cfg.updates !== undefined || cfg.repos !== undefined ? cfg : undefined;
	adopt(parsePackConfig(cfg[SECTION] ?? legacy));
}

/**
 * The last time saving the registry FAILED, or null.
 *
 * Config writes are otherwise fire-and-forget, which is the right posture for a theme preference and
 * the wrong one here: everything in this section is a promise made to the user. A pin says "do not
 * change these rules mid-campaign" — and a pin that never reached the disk still reads as pinned for
 * the rest of the session, then is simply absent at the next launch, at which point the update it
 * was holding back can arrive. That is the one failure the user has to hear about, because the fix
 * (a full disk, a read-only or disconnected data folder) is entirely on their side.
 */
export const packConfigError = $state<{ message: string | null }>({ message: null });

/** Persist through the shared section writer: read-merge-write, queued per file, and stringified at
 *  execution time so the last write reflects the latest state. */
function persist(): void {
	writeConfigSection(CONFIG_PATH, SECTION, packConfig, (error) => {
		packConfigError.message = error === null ? null : errText(error);
	});
}

/** Record an installed pack (the installer calls this), or re-point an existing one at a new repo.
 *  `remotePack` is only stored when the repo calls it something else than the folder it landed in. */
export function registerPack(pack: string, repo: string, remotePack?: string): void {
	const existing = packConfig.packs[pack];
	const remote = remotePack !== undefined && remotePack !== pack ? { remotePack } : {};
	packConfig.packs[pack] = { ...existing, repo, ...remote };
	packConfig.repos[repo] ??= {};
	persist();
}

/**
 * Which local folder holds this repo's `<remotePack>`, if any. The registry is keyed by the LOCAL
 * folder, so a check — which only knows what the repo calls things — has to come back this way.
 *
 * Looking the remote name up directly was the bug: two repos can both publish `srd-2024`, and the
 * lookup would find the other one's entry, compare it against the wrong URL, and either skip a real
 * update or offer one repo's files for the other repo's folder.
 */
export function localPackFor(repo: string, remotePack: string): string | undefined {
	return Object.keys(packConfig.packs)
		.sort()
		.find((pack) => {
			const entry = packConfig.packs[pack];
			return entry !== undefined && entry.repo === repo && remoteNameOf(pack, entry) === remotePack;
		});
}

/**
 * A folder name that is free to install into: `preferred`, or `preferred-2`, `-3`… A name is taken
 * if the registry claims it or if `onDisk` holds it (a folder can exist without an entry — the user
 * may have copied one in by hand, and overwriting it would be the data loss this whole check exists
 * to avoid). Reserved names never win either, so a repo publishing `homebrew` gets `homebrew-2`
 * rather than the user's authoring root.
 */
export function freeLocalPackName(preferred: string, onDisk: string[] = []): string {
	// case-FOLDED, because that is how the filesystem answers: on NTFS/APFS `SRD-2024` and
	// `srd-2024` are one directory, so an exact-string "free" is how one pack lands on another
	const taken = new Set([...Object.keys(packConfig.packs), ...onDisk].map((n) => n.toLowerCase()));
	const free = (name: string) => !taken.has(name.toLowerCase()) && isUsablePackFolderName(name);
	// sanitised FIRST, so the suffix loop below is guaranteed to reach a usable name
	const base = sanitisePackFolderName(preferred);
	if (free(base)) return base;
	for (let n = 2; ; n++) if (free(`${base}-${n}`)) return `${base}-${n}`;
}

/** Rename the folder a pack lives in, keeping its repo, its pin and where it came from. The caller
 *  moves the files; this moves the bookkeeping. Remembers the repo's own name for it, so the next
 *  check still asks for the right path. */
export function renamePackEntry(from: string, to: string): void {
	const entry = packConfig.packs[from];
	if (!entry || from === to) return;
	const remotePack = remoteNameOf(from, entry);
	delete packConfig.packs[from];
	// rebuilt rather than spread, so renaming a folder BACK to what the repo calls it drops the
	// override instead of leaving a `remotePack` that redundantly repeats the key
	packConfig.packs[to] = {
		repo: entry.repo,
		...(entry.pinned === undefined ? {} : { pinned: entry.pinned }),
		...(remotePack === to ? {} : { remotePack }),
	};
	const pending = packConfig.pending[from];
	if (pending) {
		delete packConfig.pending[from];
		packConfig.pending[to] = pending;
	}
	persist();
}

/** Remember an update we found, so a relaunch doesn't lose it (see {@link PendingRemote}). */
export function rememberPending(pack: string, remote: PendingRemote): void {
	packConfig.pending[pack] = remote;
	persist();
}

/** It was applied, refused, or the pack is gone — either way there is nothing left to offer. */
export function forgetPending(pack: string): void {
	if (packConfig.pending[pack] === undefined) return;
	delete packConfig.pending[pack];
	persist();
}

/** Forget a pack (it was uninstalled). Its repo's check state is dropped once nothing uses it. */
export function forgetPack(pack: string): void {
	delete packConfig.packs[pack];
	delete packConfig.pending[pack];
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

/** Remember which branch this repo's listing came off (see {@link RepoEntry.branch}). Separate from
 *  `recordCheck` because the two answer different questions and one of them — an install straight
 *  after pasting a URL — has a branch to record and no check to claim. */
export function setRepoBranch(repo: string, branch: string): void {
	const prev = packConfig.repos[repo] ?? {};
	if (prev.branch === branch) return;
	packConfig.repos[repo] = { ...prev, branch };
	persist();
}

/**
 * Remember that we asked this repo — including a `304`, which is exactly the case worth recording
 * (it cost nothing and means "still current").
 *
 * The `etag` argument has three states, because the caller has three things to say: a string is a
 * new listing to remember, `undefined` keeps whatever we had (the `304` path — the stored one is
 * still the current one), and **`null` throws it away**. That last one is for a listing that
 * arrived and was NOT fully acted on: the ETag means "I have seen this remote state", and while it
 * is on disk the next check is a free `304` that returns before it looks at a single pack. So a
 * refusal recorded alongside one is a refusal the user is told about exactly once, ever.
 */
export function recordCheck(repo: string, at: Date, etag?: string | null): void {
	const next = { ...(packConfig.repos[repo] ?? {}), lastCheckedAt: at.toISOString() };
	if (etag === null) delete next.etag;
	else if (etag !== undefined) next.etag = etag;
	packConfig.repos[repo] = next;
	persist();
}
