import { defineConfig } from 'vitest/config';

// Pure-TS core/content/character/storage tests run in node, WITHOUT the SvelteKit
// plugin. Component tests (browser mode) get their own config later (P9).
export default defineConfig({
	test: {
		include: ['src/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts'],
		environment: 'node'
	}
});
