import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/*
 * THE FAST PASS — syntax-only, no TypeScript program. This is what the pre-commit hook runs.
 *
 * The type-aware rules live in `eslint.typed.config.js`, which extends this one and is what
 * `pnpm lint` (pre-push) and CI run. They are split because type information costs ~17s to build
 * BEFORE the first file is examined — measured, and a fixed cost that neither `--cache` nor linting
 * fewer files shrinks. Paying it on every commit is not worth it; paying it beside `pnpm test` is.
 */
export default ts.config(
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: {
			// __APP_VERSION__ is a Vite `define` compile-time constant (see vite.config.ts / app.d.ts).
			globals: { ...globals.browser, ...globals.node, __APP_VERSION__: 'readonly' },
		},
		rules: {
			// runtime-tagged unused (leading _) is intentional
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
			],
			// Ban the type-escape hatches (recommended already errors on `any` + ts-comments; this adds
			// the non-null `!`, which silently defeats strict null-checks). `noUncheckedIndexedAccess` is
			// on, so handle absence explicitly (`?.`, a guard, `?? fallback`) instead of asserting it away.
			'@typescript-eslint/no-non-null-assertion': 'error',
			// An object-literal `as T` is the other escape hatch: it type-checks a MISSING field as if
			// it were there (excess-property checking is skipped), which is how a half-built literal
			// passes for a full model. Annotate the variable instead and let assignment check it.
			'@typescript-eslint/consistent-type-assertions': [
				'error',
				{ assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
			],
			// NOT `no-nested-ternary`: one nested arm still reads as one sentence ("+n, −n, or 0"), and
			// the only rule that draws the line at depth (`unicorn/no-nested-ternary`) demands parens
			// that prettier immediately strips — the two can never both be satisfied. A ladder of three
			// or more arms is a review call: say it with an if/else, a lookup table, or early returns.
			// local Maps inside $derived computations aren't reactive state — plain Map is correct
			'svelte/prefer-svelte-reactivity': 'off',
			// internal links prepend `base` manually (SPA under a subpath) — intentional
			'svelte/no-navigation-without-resolve': 'off',
		},
	},
	{
		// tests build deliberately-partial / invalid inputs and assert on array indices; the non-null
		// `!` after a length/shape assertion is a pragmatic test idiom, not a production escape hatch.
		files: ['**/*.test.ts'],
		rules: {
			'@typescript-eslint/no-non-null-assertion': 'off',
			// same reason: a fixture is deliberately partial ("a play-state with only hp"), and the
			// point of the test is what the code does with it — annotating it fully would be a lie.
			'@typescript-eslint/consistent-type-assertions': 'off',
		},
	},
	{
		// ARCHITECTURE GATE (PLAN invariant): Tauri is imported ONLY behind the Storage seam
		// (lib/storage/tauri.ts), the desktop-only updater module, and the diagnostics logger (which
		// dynamically imports tauri-plugin-log). Everything else talks to the `Storage` interface /
		// store functions, so the web + test builds never touch Tauri.
		files: ['src/**'],
		ignores: [
			'src/lib/storage/tauri.ts',
			'src/lib/update/**',
			'src/lib/diag/**',
			// the content-pack fetcher: an HTTP client in Rust behind the RemoteFetcher seam, for the
			// same reason storage/tauri.ts is exempt (SECURITY.md §5 — never webview fetch)
			'src/lib/content/remote/tauri-fetch.ts',
		],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['@tauri-apps/*', '@tauri-apps/**'],
							message:
								'Tauri imports live ONLY in lib/storage/tauri.ts (Storage seam) or lib/update — go through the Storage interface instead (docs/PLAN.md invariant).',
						},
					],
				},
			],
			// `no-restricted-imports` is blind to `import()` expressions, so the gate above stopped at
			// the static half and a dynamic `import('@tauri-apps/plugin-opener')` crossed the seam
			// unnoticed. Same invariant, the syntax the other rule cannot see.
			'no-restricted-syntax': [
				'error',
				{
					selector: 'ImportExpression > Literal[value=/^@tauri-apps/]',
					message:
						'Tauri imports live ONLY in lib/storage/tauri.ts (Storage seam) or lib/update — a dynamic import is the same crossing (docs/plan.md invariant).',
				},
			],
		},
	},
	{
		// ARCHITECTURE GATE (PLAN invariant): the effects engine is optional/removable — the pure
		// rules core must never depend on it. (character/derive + build/derive are the composition
		// points where effects legally join, so only rules/** is fenced.)
		files: ['src/lib/rules/**'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['$lib/effects', '$lib/effects/**', '**/effects/index*', '../effects/**'],
							message:
								'The rules/build/character core must not import the effects module — it is an optional, removable layer composed on top (docs/PLAN.md invariant).',
						},
					],
				},
			],
		},
	},
	{
		// SIZE GUARDRAIL — on LOGIC only. `**/*.ts` matches plain modules AND `.svelte.ts` view-models
		// (pure logic, no markup), but NOT `.svelte` (mostly template + CSS, so a line count there
		// measures the wrong thing). Industry sweet-spot is ~150-300 lines, split by ~400; these are
		// WARN (never fail CI — `pnpm lint` runs `eslint .` with no --max-warnings) so growth stays
		// visible without blocking. Blank lines + comments don't count. Tests are exempt (long
		// fixtures / index-assertions are a legitimate idiom).
		files: ['**/*.ts'],
		ignores: ['**/*.test.ts'],
		rules: {
			'max-lines': ['warn', { max: 400, skipBlankLines: true, skipComments: true }],
			'max-lines-per-function': [
				'warn',
				{ max: 80, skipBlankLines: true, skipComments: true, IIFEs: false },
			],
			// size ≠ tangle: a short function with many branches is still hard to reason about. Set at
			// the standard 20 (not stricter) on purpose — a flat `switch(kind)` dispatch (the parsers /
			// evaluators here) is legitimately branchy but readable, and flagging those at 12 floods the
			// signal; 20 targets genuine tangle (deriveSheet, collectFacts, resolveActiveEffects…).
			complexity: ['warn', { max: 20 }],
			// nesting: 3+ deep conditionals/loops → invert with early returns / extract.
			'max-depth': ['warn', 4],
			// machine-enforce the "group related args into ONE typed object, don't scatter params"
			// house rule ([[model-state-as-typed-objects]]); 5+ positional params is the smell.
			'max-params': ['warn', 4],
		},
	},
	{
		// All app logging goes through the `$lib/diag` facade (DIAG-1), never raw `console` — so a bug
		// report actually captures something and the desktop file sink sees it. The facade itself is the
		// one allowed console site (its dev/web mirror, already inline-disabled). Tests are exempt.
		files: ['src/**'],
		ignores: ['src/lib/diag/**', '**/*.test.ts'],
		rules: {
			'no-console': 'error',
		},
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
			},
		},
	},
	{
		ignores: [
			'build/',
			'.svelte-kit/',
			'dist/',
			'static/',
			'node_modules/',
			'src-tauri/',
			'tools/',
			'coverage/',
			// gitignored scratch: design mocks + their vendored support scripts, not our code to lint
			'design-preview/',
		],
	},
);
