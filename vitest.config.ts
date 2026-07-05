import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Pure-TS core/content/character/storage tests run in node, WITHOUT the SvelteKit
// plugin. Component tests (browser mode) get their own config later (P9).
// The SvelteKit plugin is absent here, so mirror its `$lib` alias by hand — otherwise a
// runtime (value) import of `$lib/...` in a tested module can't be resolved.
export default defineConfig({
	test: {
		include: ['src/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts'],
		environment: 'node'
	},
	resolve: {
		alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) }
	}
});
