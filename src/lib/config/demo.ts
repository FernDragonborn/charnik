/*
 * Demo-build flag. A demo deployment (the hosted GitHub Pages preview, or any build with
 * `PUBLIC_DEMO=true`) is READ-ONLY for content: the user can browse but not save edits — writes are
 * blocked with a clear message. This is a build-time policy flag, NOT a platform check: the web
 * build can otherwise write (homebrew → IndexedDB); only a demo build opts out. The heuristic
 * mirrors the roster banner: explicit flag, or dev, or a non-root base path (the Pages build serves
 * under `/charnik`) — but never the shipped desktop app (base '', not dev, no flag).
 */
import { dev } from '$app/environment';
import { base } from '$app/paths';
import { env } from '$env/dynamic/public';
import { detectPlatform, Platform } from '$lib/storage/provider';

export function isDemo(): boolean {
	return env.PUBLIC_DEMO === 'true' || dev || base !== '';
}

/**
 * Whether shipped content is READ-ONLY here → block saves with a message. This is the demo flag
 * MINUS the desktop app: the desktop `tauri dev` build reports `dev === true` (so `isDemo()` is
 * true) yet is genuinely writable (its own data folder), so it must never be gated. Only a hosted /
 * flagged demo — which is always the web/headless target — is read-only.
 */
export function isReadOnlyContent(): boolean {
	return isDemo() && detectPlatform() !== Platform.Desktop;
}
