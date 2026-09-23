import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { requireContentRepo } from './tools/content-repo.mjs';
import { vendorContent } from './tools/build-static-content.mjs';

// The shipped app version, read from package.json at build time and exposed as the compile-time
// constant `__APP_VERSION__` (see src/app.d.ts). The diagnostics bundle stamps it so a bug report
// says which build it came from, without a runtime Tauri call on web.
const appVersion: string = JSON.parse(
	readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version;

/**
 * Keep `static/content/` in step with the content repo while the dev server is up.
 *
 * The server serves the VENDORED COPY, not the repo (tools/build-static-content.mjs), so without
 * this a CSV you just edited in `charnik-content-srd` is invisible to the running app — silently,
 * and asymmetrically: the node tests read the repo directly and go green while the browser shows the
 * old numbers, so the app looks like it has a bug the tests deny.
 *
 * Re-copying is whole-tree and takes milliseconds, so there is nothing to gain by tracking WHICH
 * file changed; the debounce is only there because one editor save and one `git pull` both arrive as
 * a burst of events.
 *
 * It rides VITE'S watcher rather than opening one of its own, because vite RESTARTS this server
 * whenever this file changes — a hand-rolled `fs.watch` survives that restart with nobody left
 * holding its handle, so every config edit in a session adds another copy of the callback and
 * another reload per save. Vite closes its own.
 */
const contentWatch: Plugin = {
	name: 'charnik-content-watch',
	apply: 'serve',
	configureServer(server) {
		const contentRepo = requireContentRepo().replace(/\\/g, '/');
		let queued: ReturnType<typeof setTimeout> | undefined;
		server.watcher.add(contentRepo);
		server.watcher.on('all', (_event, changed) => {
			const path = changed.replace(/\\/g, '/');
			// the watcher carries the whole project; `.git` churns on every command in the content repo
			// (index.lock, refs, objects) and holds nothing we ship
			if (!path.startsWith(`${contentRepo}/`) || path.includes('/.git/')) return;
			clearTimeout(queued);
			queued = setTimeout(() => {
				try {
					vendorContent({ clean: false });
					// vite serves `static/` as public assets; whether it reloads for a change it did not
					// make is not ours to rely on — say so directly rather than hope
					server.ws.send({ type: 'full-reload' });
				} catch (e) {
					server.config.logger.error(
						`content re-vendor failed: ${e instanceof Error ? e.message : e}`,
					);
				}
			}, 150);
		});
		server.config.logger.info(`watching content: ${contentRepo}`);
	},
};

// SvelteKit's `paths.base` must be '' or a '/'-prefixed string. Normalize the raw env var.
function basePath(): '' | `/${string}` {
	const raw = process.env.BASE_PATH ?? '';
	if (!raw) return '';
	return raw.startsWith('/') ? (raw as `/${string}`) : `/${raw}`;
}

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(appVersion),
	},
	// Don't let Vite's dev watcher descend into the Rust build tree — `src-tauri/target` holds a
	// locked `app.exe` during a Tauri build/run, which crashes chokidar with EBUSY (standard
	// Tauri+Vite setting).
	server: { watch: { ignored: ['**/src-tauri/**'] } },
	plugins: [
		contentWatch,
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
			},
			// Static SPA. `404.html` fallback enables client-side routing on BOTH targets:
			// Tauri loads the prerendered index.html; GitHub Pages serves 404.html for deep
			// links. `BASE_PATH` is set to the repo subpath for the Pages build, empty for
			// desktop (served at root).
			adapter: adapter({ fallback: '404.html', strict: false }),
			paths: { base: basePath() },
		}),
	],
});
