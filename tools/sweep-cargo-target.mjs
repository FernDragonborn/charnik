/*
 * Keep `src-tauri/target` from growing without end. Cargo never deletes an artifact it no longer
 * uses: every dependency bump and every feature set (`--features table-link`, `cargo test`) leaves
 * another hashed copy beside the old ones, and the folder reaches tens of gigabytes.
 *
 * A profile over the cap is cleaned whole by `cargo clean`, never pruned file by file: a pruned
 * folder keeps fingerprints whose `.rmeta` is gone, and the next build fails with "extern location
 * for <crate> does not exist" — which `cargo sweep --maxsize` did here. The cap sits above the
 * working set (the default build, `--features table-link` and `cargo test` each keep a copy of the
 * app crate, about 15 GiB together), so a clean is rare rather than every start.
 * Runs before `tauri dev` / `tauri build` (`src-tauri/tauri.conf.json`).
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAURI_DIR = fileURLToPath(new URL('../src-tauri/', import.meta.url));
const TARGET_DIR = join(TAURI_DIR, 'target');
const CAP_GIB = 30;
const GIB = 1024 ** 3;

/** Folder → the `cargo clean` flags that remove exactly it. */
const PROFILES = [
	{ folder: 'debug', flags: ['--profile', 'dev'] },
	{ folder: 'release', flags: ['--release'] },
];

const cargo = (args) => spawnSync('cargo', args, { cwd: TAURI_DIR, encoding: 'utf8' });

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

function cleanWholeProfiles() {
	for (const { folder, flags } of PROFILES) {
		const bytes = folderBytes(join(TARGET_DIR, folder));
		if (bytes <= CAP_GIB * GIB) continue;
		console.log(`sweep: target/${folder} is ${(bytes / GIB).toFixed(1)} GiB — cleaning it whole.`);
		// best-effort: a running app.exe locks its own binary on Windows; the next start tries again
		if (cargo(['clean', ...flags]).status !== 0)
			console.warn(`sweep: cargo clean ${flags.join(' ')} failed; close the app and run it again`);
	}
}

cleanWholeProfiles();
