import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Static SPA. `404.html` fallback enables client-side routing on BOTH targets:
			// Tauri loads the prerendered index.html; GitHub Pages serves 404.html for deep
			// links. `BASE_PATH` is set to the repo subpath for the Pages build, empty for
			// desktop (served at root).
			adapter: adapter({ fallback: '404.html', strict: false }),
			paths: { base: process.env.BASE_PATH ?? '' }
		})
	]
});
