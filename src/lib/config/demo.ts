/*
 * Demo-build flag. A demo deployment (the hosted GitHub Pages preview, or any build with
 * `PUBLIC_DEMO=true`) is READ-ONLY for content: the user can browse but not save edits — writes are
 * blocked with a clear message. This is a build-time policy flag, NOT a platform check: the web
 * build can otherwise write (homebrew → IndexedDB); only a demo build opts out. The heuristic
 * mirrors the roster banner: explicit flag, or dev, or a non-root base path (the Pages build serves
 * under `/charnik`) — but never the shipped desktop app (base '', not dev, no flag).
 */
import { dev } from '$app/env';
import { BASE_PATH } from '#lib/config/base-path.ts';
import { PUBLIC_DEMO } from '$app/env/public';
import { detectPlatform, Platform } from '#lib/storage/provider.ts';

/** Show the demo banner: the hosted preview, a `PUBLIC_DEMO=true` build, OR dev (so it can be
 *  previewed while developing). This is informational only — it does NOT gate writes. */
export function isDemo(): boolean {
	return PUBLIC_DEMO === 'true' || dev || BASE_PATH !== '';
}

/**
 * Whether shipped content is READ-ONLY here → block saves with a message. Stricter than the banner:
 * `dev` is deliberately EXCLUDED so you can actually test editing locally, and the desktop app is
 * always writable (its own data folder). So only a genuinely-hosted demo — an explicit
 * `PUBLIC_DEMO=true`, or the Pages build under a non-root base — on a non-desktop target is read-only.
 */
export function isReadOnlyContent(): boolean {
	if (detectPlatform() === Platform.Desktop) return false;
	return PUBLIC_DEMO === 'true' || BASE_PATH !== '';
}
