/*
 * A pack's LIFE OUTSIDE the update cycle: arriving, being renamed, leaving. Split from
 * `updates.svelte.ts`, which had grown to hold both — an update is a pack that already lives here
 * changing, and these four are the ones that decide whether it lives here at all.
 *
 * Installing deliberately runs the SAME diff+apply path as an update rather than a "just write the
 * files" shortcut, which is why the two halves stay neighbours: the guarantees a hand-edited file
 * gets from an update are the guarantees a re-install has to honour too.
 */
import { getUserStorage } from '$lib/storage/provider';
import { revokePackPlugins } from '$lib/effects/plugin-store.svelte';
import { content } from '../store.svelte';
import {
	bundledPacks,
	claimedPackName,
	forgetPack,
	freeLocalPackName,
	isReservedPackName,
	isUsablePackFolderName,
	localPackFor,
	packConfig,
	registerPack,
	renamePackEntry,
	setRepoBranch,
	unDismissMissing,
} from '../packs.svelte';
import { discoverContentRoots, packNameOf } from '../disk';
import { renameFileRoot } from '../sources.svelte';
import {
	checkRepo,
	packSizeRefusal,
	packTooLarge,
	parseGithubRepo,
	type GithubRepo,
} from './github';
import { diffPack } from './diff';
import {
	applyPackUpdate,
	duringPackWrite,
	pluginsIn,
	removeStaging,
	type ApplyResult,
} from './install';
import {
	updates,
	fail,
	refuse,
	clearErrors,
	guarded,
	guardedDisk,
	noListing,
	checkFailure,
} from './pack-update-state.svelte';
import { tauriFetcher } from './tauri-fetch';
import { type RemoteFetcher } from './types';

/**
 * Ask a pasted repo URL what packs it holds. Nothing is written and nothing is registered: this is
 * the "show me first" half, and it is deliberately separate from installing, because a repo can
 * hold several packs and because a pack may carry plugins the user must see BEFORE saying yes.
 */
export async function discoverPacks(
	repo: string,
	opts: { fetcher?: RemoteFetcher } = {},
): Promise<void> {
	updates.checking = true;
	clearErrors();
	updates.discovered = [];
	try {
		const res = await checkRepo(opts.fetcher ?? tauriFetcher, repo);
		if (noListing(res)) {
			fail(checkFailure(res, repo));
			return;
		}
		// `unchanged` can't happen here — a first look sends no ETag
		if (res.kind !== 'packs') return;
		// A folder name the app owns is never an installable pack, however the repo spells it —
		// `homebrew` above all, which would install straight into the user's own authoring root and
		// make "uninstall that pack" delete everything they ever wrote (`isReservedPackName`).
		// …and one that would be an unbounded download is refused here rather than half-way through it:
		// the tree is the only place the whole file list exists before the first byte is asked for.
		const oversized = res.packs.map(packSizeRefusal).find((e) => e !== null);
		if (oversized) fail(oversized);
		// a folder that already exists but belongs to no registry entry is still TAKEN — a pack copied
		// in by hand must not be overwritten by a stranger that happens to share its name
		const onDisk = (await discoverContentRoots(getUserStorage()).catch(() => [])).map(packNameOf);
		updates.discovered = res.packs
			.filter((remote) => !isReservedPackName(remote.pack) && packTooLarge(remote) === null)
			.map((remote) => {
				const already = localPackFor(repo, remote.pack);
				return {
					pack: remote.pack,
					repo,
					// carried rather than re-derived: nothing is registered yet, so `fetchRepo` has nowhere
					// to read it from, and the install downloads off this branch
					branch: res.branch,
					remote,
					files: remote.files.length,
					plugins: pluginsIn(remote),
					installed: already !== undefined,
					// Where it would land: its own name normally, something else when that name is already
					// somebody's. Folder names are not the publisher's to reserve, and two repos both
					// publishing `srd-2024` is a thing to resolve rather than refuse — so the second one
					// gets a suggestion the user can overrule before installing.
					localName: already ?? freeLocalPackName(remote.pack, onDisk),
				};
			});
		// "nothing here" is the wrong thing to say when we found something and refused it for size
		if (updates.discovered.length === 0 && !oversized)
			fail({ kind: 'i18n', key: 'settings.packs.noPacksFound', values: { repo } });
	} finally {
		updates.checking = false;
	}
}

/**
 * Install one discovered pack. Runs the SAME diff+apply path as an update — which is what makes a
 * folder that already exists locally behave correctly (hand-edited files preserved, a re-tagged
 * `#content-source` refused) instead of being blindly overwritten by a "fresh" install.
 * The registry entry is written only after the files land, so a failed install leaves no trace.
 *
 * `pack` names it as the REPO does; `localName` is the folder it lands in here, and the two differ
 * whenever that name was already claimed. The registry then remembers both, so the next check still
 * asks the repo for the path the repo has.
 */
export async function installPack(
	pack: string,
	opts: { fetcher?: RemoteFetcher; localName?: string; acceptSourceClaim?: boolean } = {},
): Promise<ApplyResult> {
	clearErrors();
	// Every refusal below reports; two of them used to answer a bare `null`, so the click did nothing
	// and said nothing — the one failure the user cannot see (§2.7, NULL-1).
	const found = updates.discovered.find((d) => d.pack === pack);
	if (!found) return refuse({ kind: 'i18n', key: 'settings.packs.installGone', values: { pack } });
	const typed = (opts.localName ?? found.localName).trim();
	// belt-and-braces: `discoverPacks` already filtered the remote name, but this is the function that
	// WRITES, and a reserved name is the one input that turns an install into data loss — and `local`
	// can be anything the user typed into the rename box
	if (!isUsablePackFolderName(typed))
		return refuse({ kind: 'i18n', key: 'settings.packs.badFolderName', values: { name: typed } });
	// …and it must not be somebody else's folder. Only the entry this repo already owns may be
	// written over; anything else is the collision the suggested name exists to step around.
	// Matched case-INSENSITIVELY, because NTFS/APFS fold case: `SRD-2024` typed beside an installed
	// `srd-2024` is the same directory, and an exact lookup calling it free is how the swap renames
	// somebody else's pack away to `.prev`.
	const storage = getUserStorage();
	const ownerName = claimedPackName(typed);
	const owner = ownerName === undefined ? undefined : packConfig.packs[ownerName];
	if (owner !== undefined && localPackFor(found.repo, pack) !== ownerName)
		return refuse({
			kind: 'i18n',
			key: 'settings.packs.folderTaken',
			values: { name: typed, repo: owner.repo },
		});
	// …and the registry is not the only claimant: a folder can exist with no entry (the user copied
	// one in by hand), and installing over it is the data loss this check exists to avoid. Same rule
	// `renamePack` and `freeLocalPackName` already apply; only the typed-in name can reach here.
	if (ownerName === undefined && (await storage.exists(`content/${typed}`)))
		return refuse({
			kind: 'i18n',
			key: 'settings.packs.folderTaken',
			values: { name: typed, repo: '' },
		});
	// our own pack under a differently-cased name is ONE folder, so write to the name the registry
	// already knows rather than minting a second entry for the same directory
	const local = ownerName ?? typed;
	const parsed = parseGithubRepo(found.repo);
	if (!parsed)
		return refuse({
			kind: 'i18n',
			key: 'settings.packs.applyBadRepo',
			values: { pack, repo: found.repo },
		});
	const repo: GithubRepo = { ...parsed, branch: found.branch };

	const res = await guarded(async () =>
		applyPackUpdate({
			storage,
			fetcher: opts.fetcher ?? tauriFetcher,
			repo,
			// inside the guard too: a first install reads the disk before it writes to it
			diff: await diffPack(storage, found.remote, local),
			// …and the graph, so a pack claiming a source another pack already publishes under is
			// caught HERE — a first install is exactly when that claim gets made
			graph: content.graph,
			acceptSourceClaim: opts.acceptSourceClaim === true,
		}),
	);
	if (res.error !== undefined) {
		fail(res.error);
		return res;
	}
	registerPack(local, found.repo, pack);
	// …and how to reach it again: the next check and every later download resolve the branch through
	// the registry, not by guessing `main` off the URL a second time
	setRepoBranch(found.repo, found.branch);
	// "I meant to delete it, stop asking" was an answer about a pack that is now BACK. Leaving the
	// flag set means deleting it a second time never prompts again — `restoreBundledPacks` already
	// clears it, and re-installing from the URL is the other way the same pack returns.
	unDismissMissing([local]);
	updates.discovered = updates.discovered.map((d) =>
		d.pack === pack ? { ...d, installed: true, localName: local } : d,
	);
	return res;
}

/**
 * Move a pack into a different folder, files and bookkeeping together — the way a name chosen at
 * install time (or a suggested `-2`) is corrected later without hand-editing the config.
 *
 * The folder name is the pack's identity here: it is what `content/` scanning finds and what a pin
 * names, so the entry moves with it and the repo's own name for the pack is remembered. Refuses
 * rather than merges when the destination exists — two packs in one folder is the state this whole
 * mechanism exists to prevent.
 */
export async function renamePack(from: string, to: string): Promise<boolean> {
	clearErrors();
	const target = to.trim();
	if (target === from) return true;
	if (!isUsablePackFolderName(target)) {
		fail({ kind: 'i18n', key: 'settings.packs.badFolderName', values: { name: to } });
		return false;
	}
	// A BUNDLED pack is identified by the folder the app ships it under and by nothing else — the seed
	// refreshes `content/<name>`, the missing-pack prompt is "the bundle has it and the disk doesn't",
	// and restore copies it back there. Moving it would leave the app reporting its own content as
	// deleted while it sits right there under another name, and offering a restore that would then
	// load every row twice.
	if (bundledPacks.packs.includes(from)) {
		fail({ kind: 'i18n', key: 'settings.packs.renameBundled', values: { name: from } });
		return false;
	}
	const storage = getUserStorage();
	// A case-ONLY rename (`srd-2024` → `SRD-2024`) is one folder changing its spelling, not a move
	// onto somebody else's — so neither taken-check applies to it, and both would otherwise refuse it
	// with "that folder is taken" naming the very pack being renamed.
	const caseOnly = target.toLowerCase() === from.toLowerCase();
	const claimed = claimedPackName(target);
	if (!caseOnly && (claimed !== undefined || (await storage.exists(`content/${target}`)))) {
		fail({
			kind: 'i18n',
			key: 'settings.packs.folderTaken',
			values: {
				name: target,
				repo: (claimed === undefined ? undefined : packConfig.packs[claimed])?.repo ?? '',
			},
		});
		return false;
	}
	// Files and bookkeeping move under one raised flag: in between, NEITHER name has a folder, and a
	// content reload landing there would read the old one as uninstalled and drop the entry this is
	// about to rewrite — leaving a renamed folder with no repo, no pin and a `true` returned for it.
	// the rename can THROW (a locked file, a folder the OS refuses) and the bookkeeping below it must
	// not be skipped silently: the failure is reported and the caller is told it did not happen
	const moved = await guardedDisk(false, () =>
		duringPackWrite(async () => {
			await storage.rename(`content/${from}`, `content/${target}`);
			// the kept undo copy belongs to the pack, not to the name it had — leaving it behind would make
			// `<from>.prev` look like an interrupted apply at the next launch and get promoted back
			if (await storage.exists(`content/${from}.prev`))
				await storage.rename(`content/${from}.prev`, `content/${target}.prev`);
			renamePackEntry(from, target);
			// …and the browse-config, which disables content FILES by path: leaving those behind would
			// turn every file the user had switched off back on, as a side effect of a rename
			renameFileRoot(`content/${from}`, `content/${target}`);
			return true;
		}),
	);
	if (!moved) return false;
	const pending = updates.pending[from];
	if (pending) {
		delete updates.pending[from];
		updates.pending[target] = { ...pending, pack: target, diff: { ...pending.diff, pack: target } };
	}
	return true;
}

/**
 * Uninstall a pack: revoke what its plugins were granted, delete its folder (which takes their code
 * with it — it lives inside the pack, PLUGINS §2) and drop the registry entry. The shipped SRD is
 * deliberately NOT special-cased here; the caller decides, and the bundled floor re-seeds it on next
 * launch anyway.
 *
 * The revoke belongs HERE, not in the button: consent lives outside the data
 * dir (PLG-SEC 12), so it outlives the files, and an invariant that depends on one component calling
 * two functions in the right order is one caller away from being false. It runs AFTER the delete
 * succeeds — `discoverPlugins` reads the registry rather than the folder, and revoking first meant a
 * failed delete left the pack installed with its permission already gone.
 */
export async function uninstallPack(pack: string): Promise<void> {
	// This deletes a folder recursively, so a reserved name reaching it is the worst outcome in the
	// module: `homebrew` here would erase everything the user ever authored. An older build could
	// have registered one before `isReservedPackName` existed — drop the entry, keep the files.
	// Nothing is revoked on this path either: the code stays on disk, so its permission should too.
	if (isReservedPackName(pack)) {
		forgetPack(pack);
		return;
	}
	// The folder goes first and the entry second, so a reload in between sees a pack that is gone
	// and forgets it — harmless here (that is what we are doing anyway), except that it would race
	// the very write that removes it. One flag, one order, one writer. Guarded, because a delete that
	// throws used to skip everything below it and say nothing: the pack stayed installed with its
	// consent revoked, and the confirm row sat there reporting success by silence.
	const removed = await guardedDisk(false, () =>
		duringPackWrite(async () => {
			const storage = getUserStorage();
			await storage.remove(`content/${pack}`);
			// …and the staging folders WITH it. A `<pack>.prev` left behind is not inert: startup recovery
			// reads a lone `.prev` as an apply that died between its two renames and renames it back, so an
			// uninstall that leaves one uninstalls nothing — the pack (and its plugin code) is on disk again
			// at the next launch, and only the revoke below keeps that code from running.
			await removeStaging(storage, pack);
			forgetPack(pack);
			return true;
		}),
	);
	if (!removed) return;
	// …and the consent LAST: it outlives the files (PLG-SEC 12), so revoking before a delete that then
	// failed left the pack installed and its permission gone.
	await revokePackPlugins(pack);
	delete updates.pending[pack];
}
