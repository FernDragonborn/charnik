import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'node:url';

// Two test projects share one plugin + alias setup:
//  - `node`: pure-TS core/content/character/storage + the rune view-models (imported and driven
//    directly — the svelte plugin compiles their `$state`/`$derived`). No DOM.
//  - `browser`: `*.browser.test.ts` mount real Svelte COMPONENTS in headless Chromium (Playwright)
//    to assert rendered DOM + interactions — node can't do that.
// The SvelteKit `$app/*` virtual modules don't exist outside a Kit build, so stub them.
const alias = {
	$lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
	'$app/environment': fileURLToPath(
		new URL('./src/test-support/app-environment.ts', import.meta.url)
	),
	'$app/paths': fileURLToPath(new URL('./src/test-support/app-paths.ts', import.meta.url)),
	'$app/navigation': fileURLToPath(new URL('./src/test-support/app-navigation.ts', import.meta.url))
};

export default defineConfig({
	plugins: [svelte({ compilerOptions: { runes: true } })],
	resolve: { alias },
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: 'node',
					include: ['src/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts'],
					exclude: ['src/**/*.browser.{test,spec}.ts'],
					environment: 'node'
				}
			},
			{
				extends: true,
				test: {
					name: 'browser',
					include: ['src/**/*.browser.{test,spec}.ts'],
					browser: {
						enabled: true,
						provider: playwright(),
						headless: true,
						instances: [{ browser: 'chromium' }]
					}
				}
			}
		]
	}
});
