/*
 * Take a translator's work into the content repo: the translated CELLS of one locale, out of a pull
 * request or any git ref, into the pack's own files.
 *
 * A translator's CSV is never copied over the pack's, and their branch is never merged: one saved
 * translation re-serialises the whole file (line endings, a new column on every row), so the two
 * differ on every line while agreeing on every cell but one. This is the app's own cell merge
 * (src/lib/content/locale-merge.ts) with the roles swapped — the pack's file is the side whose
 * structure and source text win, theirs is the side whose translation wins — written back in the
 * pack's byte style, so `git diff` in the content repo shows the translated cells — plus, the first
 * time a file gains a column, that empty column on every other row.
 *
 * Files are matched by `#content-id`, the way the app matches them, so a renamed file is the same
 * file. Nothing is committed: read the diff, run the pack's own `node check.mjs`, commit there.
 *
 * Usage: pnpm import-translations <pull request number | git ref> --locale <code>
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentPacks, requireContentRepo } from './content-repo.mjs';
import { carryLocaleCells, touchedTranslations } from '../src/lib/content/locale-merge';
import { parseContentDirectives } from '../src/lib/content/meta';
import { matchStyle, restampText } from '../src/lib/content/restamp';

const TODAY = new Date().toISOString().slice(0, 10);
/** A pack's largest CSV is a few megabytes; the default 1 MB pipe truncates it silently. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;

const args = process.argv.slice(2);
const localeAt = args.indexOf('--locale');
const locale = localeAt === -1 ? undefined : args[localeAt + 1];
const source = args.find((arg, index) => !arg.startsWith('--') && index !== localeAt + 1);
if (source === undefined || locale === undefined) {
	console.error('usage: pnpm import-translations <pull request number | git ref> --locale <code>');
	process.exit(1);
}

const repo = requireContentRepo();
const git = (...command: string[]): string =>
	execFileSync('git', ['-C', repo, ...command], { encoding: 'utf8', maxBuffer: MAX_FILE_BYTES });

/** A pull request is fetched by number, from a fork as readily as from a branch of the repo. */
let ref = source;
if (/^\d+$/.test(source)) {
	git('fetch', 'origin', `pull/${source}/head`);
	ref = 'FETCH_HEAD';
}

const idOf = (text: string): string | undefined =>
	parseContentDirectives(text).directives.get('id');

/** `#content-id` → the pack file that carries it, as a repo-relative path. */
const packFileById = new Map<string, string>();
for (const pack of contentPacks())
	for (const name of readdirSync(join(repo, pack)).filter((file) => file.endsWith('.csv'))) {
		const id = idOf(readFileSync(join(repo, pack, name), 'utf8'));
		if (id !== undefined) packFileById.set(id, `${pack}/${name}`);
	}

let changed = 0;
for (const theirPath of git('ls-tree', '-r', '--name-only', ref).split('\n')) {
	if (!theirPath.endsWith('.csv')) continue;
	const theirs = git('show', `${ref}:${theirPath}`);
	const target = packFileById.get(idOf(theirs) ?? '');
	if (target === undefined) {
		console.log(`- ${theirPath}: no pack file carries its #content-id — skipped`);
		continue;
	}
	const ours = readFileSync(join(repo, target), 'utf8');
	const { text, ...report } = await carryLocaleCells(ours, theirs, { onlyLocales: [locale] });
	if (!touchedTranslations(report)) continue;
	if (text !== ours) {
		// a translation is a data change, so the declared revision date moves with the hash
		writeFileSync(
			join(repo, target),
			matchStyle(await restampText(text, { updated_at: TODAY }), ours),
		);
		changed++;
	}
	console.log(`✓ ${target}: ${report.carried.length} rows`);
	if (report.replaced.length > 0)
		console.log(`    replaced a translation already in the pack: ${report.replaced.join(', ')}`);
	if (report.outdated.length > 0)
		console.log(`    source moved since it was translated: ${report.outdated.join(', ')}`);
	if (report.orphaned.length > 0)
		console.log(`    no such row in the pack any more: ${report.orphaned.join(', ')}`);
}

console.log(
	changed === 0
		? `nothing to import for "${locale}"`
		: `${changed} file(s) changed in ${repo} — read the diff, run check.mjs, commit there`,
);
