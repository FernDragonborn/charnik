/*
 * Keep `src-tauri/target` from growing without end. Cargo never deletes an artifact it no longer
 * uses: every dependency bump and every feature set leaves another hashed copy beside the old ones,
 * and the folder reaches tens of gigabytes.
 *
 * Before `tauri dev` / `tauri build` (`src-tauri/tauri.conf.json`) it only SAYS the debug profile
 * is over the cap. `pnpm sweep:rust` (`--prune`, `--dry-run` to only list) removes what no build of
 * ours uses, and asks Cargo which that is rather than guessing. Every build below runs with
 * `--message-format=json`, which names the files of EVERY unit, fresh ones included — that covers
 * `deps/` and `build/` — and with Cargo's fingerprint log on, which names every `.fingerprint/`
 * folder it checks: a fingerprint folder is not always named with its files' hash, so it cannot be
 * found from them. Whatever none of them names goes, so every build after is still fresh.
 * Never by age, `cargo sweep` included: an artifact every build uses but none rebuilds looks as old
 * as one nothing uses, and a folder pruned that way keeps fingerprints whose `.rmeta` is gone —
 * every build after fails with "extern location for <crate> does not exist". `incremental/` is the
 * one exception: it only caches our own crates, so a session nobody touched in two weeks goes, and
 * the worst that costs is one recompile of the app. A release folder over the cap is cleaned
 * whole: only packaging builds it.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAURI_DIR = fileURLToPath(new URL('../src-tauri/', import.meta.url));
const TARGET_DIR = join(TAURI_DIR, 'target');
const DEBUG_DIR = join(TARGET_DIR, 'debug');
const RELEASE_DIR = join(TARGET_DIR, 'release');
const CAP_GIB = 30;
const GIB = 1024 ** 3;
/** Every build of the debug profile we run: the app, the app with the table, and their tests
 *  (`tauri dev` adds `--no-default-features`, which changes nothing while there are none). */
const BUILDS = [
	['build'],
	['build', '--features', 'table-link'],
	['test', '--no-run'],
	['test', '--no-run', '--features', 'table-link'],
];
/** A `.fingerprint/<unit>` folder as Cargo's fingerprint log names it. */
const FINGERPRINT_IN_LOG = /\.fingerprint[\\/]+([^\\/"\s]+)/g;
/** An incremental session untouched this long belongs to no build still in use. */
const INCREMENTAL_IDLE_MS = 14 * 24 * 60 * 60 * 1000;

function folderBytes(path) {
	let total = 0;
	let entries;
	try {
		entries = readdirSync(path, { withFileTypes: true });
	} catch {
		return 0; // absent: nothing built yet
	}
	for (const entry of entries) {
		const child = join(path, entry.name);
		if (entry.isDirectory()) total += folderBytes(child);
		else if (entry.isFile()) total += statSync(child, { throwIfNoEntry: false })?.size ?? 0;
	}
	return total;
}

const gib = (bytes) => `${(bytes / GIB).toFixed(1)} GiB`;
const namesIn = (path) => {
	try {
		return readdirSync(path);
	} catch {
		return [];
	}
};

/** `libbytes-c39f….rlib` → `bytes-c39f…`: the unit a file in `deps/` belongs to. */
const unitOfFile = (file) => file.replace(/^lib/, '').split('.')[0];

/** The units the builds use, by `<crate>-<hash>` — or null when a build failed and nothing may go. */
function liveUnits() {
	const live = new Set();
	for (const args of BUILDS) {
		console.log(`sweep: cargo ${args.join(' ')}`);
		const run = spawnSync('cargo', [...args, '--message-format=json'], {
			cwd: TAURI_DIR,
			encoding: 'utf8',
			maxBuffer: 1024 * 1024 * 1024,
			env: { ...process.env, CARGO_LOG: 'cargo::core::compiler::fingerprint=debug' },
		});
		if (run.status !== 0) {
			console.error(`sweep: cargo ${args.join(' ')} failed — nothing removed`);
			return null;
		}
		for (const line of run.stdout.split('\n')) {
			if (!line.startsWith('{')) continue;
			const message = JSON.parse(line);
			// a file in deps/ names its unit; one in build/<unit>/ names the folder
			for (const file of message.filenames ?? []) {
				const folder = dirname(file);
				live.add(
					basename(dirname(folder)) === 'build' ? basename(folder) : unitOfFile(basename(file)),
				);
			}
			if (message.out_dir) live.add(basename(dirname(message.out_dir)));
		}
		for (const [, unit] of run.stderr.matchAll(FINGERPRINT_IN_LOG)) live.add(unit);
	}
	return live;
}

function pruneDebug() {
	const live = liveUnits();
	if (!live) return false;
	const before = folderBytes(DEBUG_DIR);
	const dryRun = process.argv.includes('--dry-run');
	let removed = 0;
	const drop = (path) => {
		if (dryRun) console.log(`would remove ${path.slice(DEBUG_DIR.length + 1)}`);
		else rmSync(path, { recursive: true, force: true });
		removed += 1;
	};
	for (const file of namesIn(join(DEBUG_DIR, 'deps')))
		if (!live.has(unitOfFile(file))) drop(join(DEBUG_DIR, 'deps', file));
	for (const folder of ['.fingerprint', 'build'])
		for (const unit of namesIn(join(DEBUG_DIR, folder)))
			if (!live.has(unit)) drop(join(DEBUG_DIR, folder, unit));
	for (const session of namesIn(join(DEBUG_DIR, 'incremental'))) {
		const path = join(DEBUG_DIR, 'incremental', session);
		if (Date.now() - statSync(path).mtimeMs > INCREMENTAL_IDLE_MS) drop(path);
	}
	const after = folderBytes(DEBUG_DIR);
	console.log(
		`sweep: target/debug ${gib(before)} → ${gib(after)}, ${removed} unused entries removed`,
	);
	return true;
}

const prune = process.argv.includes('--prune');
const debugBytes = folderBytes(DEBUG_DIR);
const releaseBytes = folderBytes(RELEASE_DIR);

if (!prune) {
	if (debugBytes > CAP_GIB * GIB)
		console.warn(
			`sweep: target/debug is ${gib(debugBytes)}, over the ${CAP_GIB} GiB cap — \`pnpm sweep:rust\` removes what no build uses`,
		);
} else {
	if (!pruneDebug()) process.exitCode = 1;
	if (releaseBytes > CAP_GIB * GIB) {
		console.log(`sweep: target/release is ${gib(releaseBytes)} — cleaning it whole`);
		// a running app.exe locks its own binary on Windows
		const cleaned = spawnSync('cargo', ['clean', '--release'], {
			cwd: TAURI_DIR,
			stdio: 'inherit',
		});
		if (cleaned.status !== 0)
			console.warn('sweep: cargo clean --release failed; close the app and run it again');
	}
}
