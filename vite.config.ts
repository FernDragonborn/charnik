import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

// The shipped app version, read from package.json at build time and exposed as the compile-time
// constant `__APP_VERSION__` (see src/app.d.ts). The diagnostics bundle stamps it so a bug report
// says which build it came from, without a runtime Tauri call on web.
const appVersion: string = JSON.parse(
	readFileSync(new URL('./package.json', import.meta.url), 'utf8')
).version;

// SvelteKit's `paths.base` must be '' or a '/'-prefixed string. Normalize the raw env var.
function basePath(): '' | `/${string}` {
	const raw = process.env.BASE_PATH ?? '';
	if (!raw) return '';
	return raw.startsWith('/') ? (raw as `/${string}`) : `/${raw}`;
}

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(appVersion)
	},
	// Don't let Vite's dev watcher descend into the Rust build tree — `src-tauri/target` holds a
	// locked `app.exe` during a Tauri build/run, which crashes chokidar with EBUSY (standard
	// Tauri+Vite setting).
	server: { watch: { ignored: ['**/src-tauri/**'] } },
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
			paths: { base: basePath() }
		})
	]
});
