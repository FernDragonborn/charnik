/*
 * Keep `src-tauri/target` from growing without end. Cargo never deletes an artifact it no longer
 * uses: every dependency bump and every feature set (`--features table-link`, `cargo test`) leaves
 * another hashed copy beside the old ones, and the folder reaches tens of gigabytes.
 *
 * Before `tauri dev` / `tauri build` (`src-tauri/tauri.conf.json`) it only SAYS a profile is over
 * the cap: cleaning costs a full Rust rebuild, which is the person's to schedule, not a surprise at
 * the start of a session. `pnpm sweep:rust` (`--clean`) cleans each profile over the cap whole.
 * Never file by file, `cargo sweep` included: an artifact every build uses but none rebuilds looks
 * as old as one nothing uses, and a pruned folder keeps fingerprints whose `.rmeta` is gone — every
 * build after fails with "extern location for <crate> does not exist". The cap sits above the
 * working set (the default build, `--features table-link` and `cargo test`, about 15 GiB together).
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

const clean = process.argv.includes('--clean');

for (const { folder, flags } of PROFILES) {
	const bytes = folderBytes(join(TARGET_DIR, folder));
	if (bytes <= CAP_GIB * GIB) continue;
	const size = `target/${folder} is ${(bytes / GIB).toFixed(1)} GiB, over the ${CAP_GIB} GiB cap`;
	if (!clean) {
		console.warn(
			`sweep: ${size} — \`pnpm sweep:rust\` cleans it, and the next build is a full one`,
		);
		continue;
	}
	console.log(`sweep: ${size} — cleaning it whole`);
	// a running app.exe locks its own binary on Windows
	if (cargo(['clean', ...flags]).status !== 0)
		console.warn(`sweep: cargo clean ${flags.join(' ')} failed; close the app and run it again`);
}
