import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

// Pure-TS core/content/character/storage tests run in node. The Svelte plugin is included so that
// `*.svelte.ts` rune modules (the view-models) can be imported and driven directly in a test — the
// `$state`/`$derived` runes need compiling. The SvelteKit plugin is absent, so mirror its `$lib`
// alias by hand — otherwise a runtime (value) import of `$lib/...` can't be resolved.
export default defineConfig({
	plugins: [svelte({ compilerOptions: { runes: true } })],
	test: {
		include: ['src/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts'],
		environment: 'node'
	},
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
			// SvelteKit's `$app/*` virtual modules don't exist outside a Kit build — stub them.
			'$app/environment': fileURLToPath(
				new URL('./src/test-support/app-environment.ts', import.meta.url)
			),
			'$app/paths': fileURLToPath(new URL('./src/test-support/app-paths.ts', import.meta.url)),
			'$app/navigation': fileURLToPath(
				new URL('./src/test-support/app-navigation.ts', import.meta.url)
			)
		}
	}
});
