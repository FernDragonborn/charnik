/*
 * THE TYPED PASS — everything in `eslint.config.js` plus the rules that need type information.
 * `pnpm lint` (pre-push) and CI run this one; the pre-commit hook runs the fast config.
 *
 * Why split at all: type-aware rules make ESLint build the whole TypeScript program before examining
 * a single file, ~17s measured — a FIXED cost that neither `--cache` nor linting fewer files
 * shrinks. Worth paying beside `pnpm test`, not on every commit.
 *
 * It covers `.svelte` as well as `.ts` on purpose: the floating promises this catches are mostly in
 * components (`+layout.svelte`, `CommandPalette.svelte`), so a `.ts`-only scope would miss the point.
 */
import ts from 'typescript-eslint';
import base from './eslint.config.js';

export default ts.config(...base, {
	// APP SOURCE ONLY. The root config files (vite/vitest/svelte.config) are outside the app's
	// tsconfig, so the project service can't place them and falls back to a program per file — pure
	// cost for files that have no promises to float.
	files: ['src/**/*.ts', 'src/**/*.svelte'],
	languageOptions: {
		parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
	},
	rules: {
		// Rule by rule rather than `recommendedTypeChecked`: that preset also drags in the `no-unsafe-*`
		// family, which fires wherever `any` enters from an untyped boundary (papaparse, JSON.parse) and
		// wants a pass of its own, plus `require-await`, which is style. Measured counts for the rest are
		// in PLAN · LINT-1. These five name a BUG.
		'@typescript-eslint/no-floating-promises': 'error',
		'@typescript-eslint/await-thenable': 'error',
		'@typescript-eslint/no-base-to-string': 'error',
		'@typescript-eslint/no-unnecessary-type-assertion': 'error',
		'@typescript-eslint/no-redundant-type-constituents': 'error',
	},
});
