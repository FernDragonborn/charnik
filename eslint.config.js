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
			globals: { ...globals.browser, ...globals.node }
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
		// (lib/storage/tauri.ts) and the desktop-only updater module. Everything else talks to the
		// `Storage` interface / store functions, so the web + test builds never touch Tauri.
		files: ['src/**'],
		ignores: ['src/lib/storage/tauri.ts', 'src/lib/update/**'],
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
