import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default ts.config(
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: {
			// __APP_VERSION__ is a Vite `define` compile-time constant (see vite.config.ts / app.d.ts).
			globals: { ...globals.browser, ...globals.node, __APP_VERSION__: 'readonly' }
		},
		rules: {
			// runtime-tagged unused (leading _) is intentional
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			],
			// Ban the type-escape hatches (recommended already errors on `any` + ts-comments; this adds
			// the non-null `!`, which silently defeats strict null-checks). `noUncheckedIndexedAccess` is
			// on, so handle absence explicitly (`?.`, a guard, `?? fallback`) instead of asserting it away.
			'@typescript-eslint/no-non-null-assertion': 'error',
			// local Maps inside $derived computations aren't reactive state — plain Map is correct
			'svelte/prefer-svelte-reactivity': 'off',
			// internal links prepend `base` manually (SPA under a subpath) — intentional
			'svelte/no-navigation-without-resolve': 'off'
		}
	},
	{
		// tests build deliberately-partial / invalid inputs and assert on array indices; the non-null
		// `!` after a length/shape assertion is a pragmatic test idiom, not a production escape hatch.
		files: ['**/*.test.ts'],
		rules: {
			'@typescript-eslint/no-non-null-assertion': 'off'
		}
	},
	{
		// ARCHITECTURE GATE (PLAN invariant): Tauri is imported ONLY behind the Storage seam
		// (lib/storage/tauri.ts), the desktop-only updater module, and the diagnostics logger (which
		// dynamically imports tauri-plugin-log). Everything else talks to the `Storage` interface /
		// store functions, so the web + test builds never touch Tauri.
		files: ['src/**'],
		ignores: ['src/lib/storage/tauri.ts', 'src/lib/update/**', 'src/lib/diag/**'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['@tauri-apps/*', '@tauri-apps/**'],
							message:
								'Tauri imports live ONLY in lib/storage/tauri.ts (Storage seam) or lib/update — go through the Storage interface instead (docs/PLAN.md invariant).'
						}
					]
				}
			]
		}
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
								'The rules/build/character core must not import the effects module — it is an optional, removable layer composed on top (docs/PLAN.md invariant).'
						}
					]
				}
			]
		}
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
				{ max: 80, skipBlankLines: true, skipComments: true, IIFEs: false }
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
			'max-params': ['warn', 4]
		}
	},
	{
		// All app logging goes through the `$lib/diag` facade (DIAG-1), never raw `console` — so a bug
		// report actually captures something and the desktop file sink sees it. The facade itself is the
		// one allowed console site (its dev/web mirror, already inline-disabled). Tests are exempt.
		files: ['src/**'],
		ignores: ['src/lib/diag/**', '**/*.test.ts'],
		rules: {
			'no-console': 'error'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
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
			'coverage/'
		]
	}
);
