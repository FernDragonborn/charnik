/*
 * REL-4 slice 1 — the installed-pack registry. The parts worth pinning are the ones a wrong answer
 * costs something: the repo/pack split (one throttle per REPO, one pin per PACK), the once-a-day
 * gate, and a corrupt config degrading to "nothing installed" instead of throwing at startup.
 */
import { describe, it, expect } from 'vitest';
import {
	claimedPackName,
	freeLocalPackName,
	isReservedPackName,
	isUsablePackFolderName,
	sanitisePackFolderName,
	parsePackConfig,
	emptyPackConfig,
	isRepoDue,
	keepMissingPacks,
	missingBundled,
	missingUnanswered,
	packConfig,
	reposDueForCheck,
	unDismissMissing,
	CHECK_INTERVAL_MS,
	UPDATE_MODE,
	type PackConfigData
} from './packs.svelte';

const REPO = 'https://github.com/FernDragonborn/charnik-content-srd';
const OTHER = 'https://github.com/someone/homebrew-packs';

const cfg = (over: Partial<PackConfigData> = {}): PackConfigData => ({
	...emptyPackConfig(),
	updates: UPDATE_MODE.notify,
	...over
});

describe('parsePackConfig', () => {
	it('a missing or malformed section is "nothing installed, never check" — never a throw', () => {
		expect(parsePackConfig(undefined)).toEqual(emptyPackConfig());
		expect(parsePackConfig(null)).toEqual(emptyPackConfig());
		expect(parsePackConfig('a string is not a section')).toEqual(emptyPackConfig());
		expect(parsePackConfig([]).packs).toEqual({}); // an array is not a record
	});
	it('an unknown update mode falls back to off — the private default, not the last one written', () => {
		expect(parsePackConfig({ updates: 'yolo' }).updates).toBe(UPDATE_MODE.off);
		expect(parsePackConfig({ updates: 'download' }).updates).toBe(UPDATE_MODE.download);
	});
	it('keeps a real registry', () => {
		const parsed = parsePackConfig({
			updates: 'notify',
			packs: { 'srd-2024': { repo: REPO }, 'srd-2014': { repo: REPO, pinned: true } },
			repos: { [REPO]: { etag: 'W/"abc"', lastCheckedAt: '2026-08-11T00:00:00.000Z' } }
		});
		expect(parsed.packs['srd-2014']?.pinned).toBe(true);
		expect(parsed.repos[REPO]?.etag).toBe('W/"abc"');
	});
});

/** Deleting a bundled pack is allowed, so the app has to say the rules are gone — once, and then
 *  stop, because a prompt you must answer at every launch is a nag rather than a warning. */
describe('the missing-content prompt', () => {
	it('prompts for a bundled pack that is not on disk', () => {
		missingBundled.packs = ['srd-2014'];
		Object.assign(packConfig, emptyPackConfig());
		expect(missingUnanswered()).toEqual(['srd-2014']);
	});

	it('"I deleted it on purpose" silences it, and survives a reload', () => {
		missingBundled.packs = ['srd-2014'];
		Object.assign(packConfig, emptyPackConfig());
		keepMissingPacks(['srd-2014']);
		expect(missingUnanswered()).toEqual([]);
		// what persistence would write, read back
		expect(parsePackConfig(JSON.parse(JSON.stringify(packConfig))).dismissedMissing).toEqual([
			'srd-2014'
		]);
	});

	it('restoring clears the answer, so deleting it AGAIN asks again', () => {
		missingBundled.packs = ['srd-2014'];
		Object.assign(packConfig, emptyPackConfig());
		keepMissingPacks(['srd-2014']);
		unDismissMissing(['srd-2014']);
		expect(missingUnanswered()).toEqual(['srd-2014']);
	});

	it('a corrupt dismissal list is ignored, not trusted into the prompt logic', () => {
		expect(parsePackConfig({ dismissedMissing: 'srd-2014' }).dismissedMissing).toEqual([]);
		expect(parsePackConfig({ dismissedMissing: [1, 'srd-2014'] }).dismissedMissing).toEqual([
			'srd-2014'
		]);
	});
});

/** "A pack is a folder" has no exceptions, so the folders the APP owns have to be defended by name
 *  — the alternative is a third-party repo shipping a folder called `homebrew` and installing into
 *  the user's own authoring root. */
describe('reserved pack names', () => {
	it('refuses the folders the app owns, case-insensitively (Windows folds case)', () => {
		expect(isReservedPackName('homebrew')).toBe(true);
		expect(isReservedPackName('HomeBrew')).toBe(true);
		expect(isReservedPackName('.pack-cache')).toBe(true);
		expect(isReservedPackName('srd-2024.new')).toBe(true);
		expect(isReservedPackName('srd-2024.prev')).toBe(true);
	});
	it('leaves an ordinary pack alone, including one that merely mentions homebrew', () => {
		expect(isReservedPackName('srd-2024')).toBe(false);
		expect(isReservedPackName('phb-homebrew')).toBe(false);
		expect(isReservedPackName('my-homebrew-pack')).toBe(false);
	});
});

/** A publisher owes us nothing about folder names, and the OS refuses several of them — as a throw
 *  from `mkdir` half-way through a swap, which is the worst possible moment to find out. */
describe('folder names the app can actually create', () => {
	it('accepts ordinary names, spaces and dashes included', () => {
		expect(isUsablePackFolderName('srd-2024')).toBe(true);
		expect(isUsablePackFolderName('My Homebrew Pack')).toBe(true);
	});
	it('refuses separators, the characters Windows reserves, and control characters', () => {
		for (const bad of ['', 'a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b'])
			expect(isUsablePackFolderName(bad)).toBe(false);
		expect(isUsablePackFolderName(`a${String.fromCharCode(7)}b`)).toBe(false);
	});
	it('refuses a trailing dot or space — Windows strips them, so two names become one folder', () => {
		expect(isUsablePackFolderName('srd ')).toBe(false);
		expect(isUsablePackFolderName('srd.')).toBe(false);
	});
	it('refuses the DOS device names, with or without an extension', () => {
		for (const bad of ['nul', 'CON', 'aux.csv', 'com1', 'LPT9'])
			expect(isUsablePackFolderName(bad)).toBe(false);
		expect(isUsablePackFolderName('nullify')).toBe(true); // only the exact name is a device
	});

	it('sanitises an unusable name into one that IS usable — and always terminates', () => {
		for (const raw of ['foo:bar', '.git', 'homebrew', 'nul', '???', 'trailing.'])
			expect(isUsablePackFolderName(sanitisePackFolderName(raw))).toBe(true);
		expect(sanitisePackFolderName('foo:bar')).toBe('foo-bar');
		expect(sanitisePackFolderName('srd-2024')).toBe('srd-2024'); // a good name is left alone
	});
});

/** NTFS and APFS fold case, so `SRD-2024` and `srd-2024` are ONE directory. An exact-string "that
 *  name is free" is how a stranger's pack lands on top of one the user already had. */
describe('a folder name is claimed the way the filesystem claims it', () => {
	it('finds the registry entry whose case differs', () => {
		packConfig.packs = { 'srd-2024': { repo: 'r' } };
		expect(claimedPackName('SRD-2024')).toBe('srd-2024');
		expect(claimedPackName('other')).toBeUndefined();
		packConfig.packs = {};
	});
	it('never suggests a name that only differs from an installed one by case', () => {
		packConfig.packs = { 'srd-2024': { repo: 'r' } };
		expect(freeLocalPackName('SRD-2024')).toBe('SRD-2024-2');
		expect(freeLocalPackName('srd-2024', ['SRD-2024-2'])).toBe('srd-2024-3');
		packConfig.packs = {};
	});
});

describe('the throttle is per REPO, once a day', () => {
	const now = Date.parse('2026-08-11T12:00:00.000Z');
	it('a repo never checked is due', () => {
		expect(isRepoDue(undefined, now)).toBe(true);
		expect(isRepoDue({ etag: 'x' }, now)).toBe(true);
	});
	it('checked just now is not due; a day later it is', () => {
		const at = new Date(now - 60_000).toISOString();
		expect(isRepoDue({ lastCheckedAt: at }, now)).toBe(false);
		expect(isRepoDue({ lastCheckedAt: at }, now + CHECK_INTERVAL_MS)).toBe(true);
	});
	it('an unparseable timestamp is treated as never checked, not as "wait forever"', () => {
		expect(isRepoDue({ lastCheckedAt: 'sometime' }, now)).toBe(true);
	});
});

describe('reposDueForCheck', () => {
	const now = Date.parse('2026-08-11T12:00:00.000Z');
	const twoPacksOneRepo = {
		packs: { 'srd-2024': { repo: REPO }, 'srd-2014': { repo: REPO } },
		repos: {}
	};

	it('two packs from ONE repo are one request — that is the whole point of the split', () => {
		expect(reposDueForCheck(cfg(twoPacksOneRepo), now)).toEqual([REPO]);
	});
	it('mode off means the app never reaches the network on its own', () => {
		expect(reposDueForCheck(cfg({ ...twoPacksOneRepo, updates: UPDATE_MODE.off }), now)).toEqual(
			[]
		);
	});
	it('a repo whose every pack is pinned is not contacted — we would refuse the answer anyway', () => {
		const pinned = {
			packs: { 'srd-2024': { repo: REPO, pinned: true }, 'srd-2014': { repo: REPO, pinned: true } },
			repos: {}
		};
		expect(reposDueForCheck(cfg(pinned), now)).toEqual([]);
	});
	it('but ONE unpinned pack keeps its repo live', () => {
		const mixed = {
			packs: { 'srd-2024': { repo: REPO, pinned: true }, 'srd-2014': { repo: REPO } },
			repos: {}
		};
		expect(reposDueForCheck(cfg(mixed), now)).toEqual([REPO]);
	});
	it('only repos past the throttle, and deterministically ordered', () => {
		const two = {
			packs: { a: { repo: REPO }, b: { repo: OTHER } },
			repos: { [OTHER]: { lastCheckedAt: new Date(now - 1000).toISOString() } }
		};
		expect(reposDueForCheck(cfg(two), now)).toEqual([REPO]); // OTHER checked a second ago
		expect(reposDueForCheck(cfg(two), now + CHECK_INTERVAL_MS)).toEqual([OTHER, REPO].sort());
	});
});
