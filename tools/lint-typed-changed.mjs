/*
 * The type-aware lint pass, scoped to what you touched.
 *
 * `pnpm lint:typed` takes ~9m30 over the whole repo, and almost all of it is per-file work: building
 * the TypeScript program costs ~11 s and then every file is linted with type information. Measured
 * here, one changed file and eight changed files both finish in ~11 s — so the scoped pass is the
 * same check at 1/50 the wait, which is the difference between running it and not.
 *
 * It does NOT replace the full pass. A type-aware rule can fire in a file you did not edit: widen a
 * return type to `Promise<T>` and the floating promise appears in its callers. The full
 * `pnpm lint:typed` stays the pre-release gate; this is the one you run while working.
 *
 * Usage: node tools/lint-typed-changed.mjs [ref]
 *        pnpm lint:typed:changed          → working tree vs HEAD, plus new files
 *        pnpm lint:typed:changed HEAD~1   → also what the last commit changed
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');
const baseRef = process.argv[2] ?? 'HEAD';

/** What the typed config covers — app source only; see config/eslint.typed.config.js. */
const LINTABLE = /^src\/.+\.(ts|svelte)$/;

function gitLines(...args) {
	const { status, stdout, stderr } = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
	if (status !== 0) {
		process.stderr.write(stderr);
		process.exit(status ?? 1);
	}
	return stdout.split('\n').filter(Boolean);
}

// Untracked files are included unconditionally: a file you just wrote is exactly the one whose
// floating promises nobody has looked at yet, and `git diff` cannot see it.
const changed = gitLines('diff', '--name-only', '--diff-filter=ACMR', baseRef);
const untracked = gitLines('ls-files', '--others', '--exclude-standard');
const files = [...new Set([...changed, ...untracked])].filter((path) => LINTABLE.test(path));

if (files.length === 0) {
	console.log(`No changed src files vs ${baseRef} — nothing to lint.`);
	process.exit(0);
}

console.log(`Type-aware lint over ${files.length} changed file(s) vs ${baseRef}:`);
for (const file of files) console.log(`  ${file}`);

const eslint = spawnSync(
	process.execPath,
	[
		join(repoRoot, 'node_modules', 'eslint', 'bin', 'eslint.js'),
		'-c',
		'config/eslint.typed.config.js',
		...files,
	],
	{ cwd: repoRoot, stdio: 'inherit' },
);
process.exit(eslint.status ?? 1);
