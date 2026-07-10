// Desktop self-update, behind the platform seam. On launch the shell runs `checkForUpdate` once; if a
// newer signed release exists the header surfaces a gold "update" chip that calls `installUpdate`
// (download → install → relaunch). On web/headless the checks no-op, so importing this is inert there.
import type { Update } from '@tauri-apps/plugin-updater';
import { detectPlatform, Platform } from '$lib/storage/provider';

export type UpdateStatus = 'idle' | 'available' | 'downloading' | 'installing' | 'error';

// The pending Update handle is neither reactive nor serializable — keep it out of $state, keyed only
// by the reactive fields below that the UI actually reads.
let pending: Update | null = null;

// Dev-only preview flag: when set, `installUpdate` fakes the download instead of touching a real
// (absent) handle. Guarded everywhere by import.meta.env.DEV so it tree-shakes out of production.
let fakeUpdate = false;

export const updater = $state({
	status: 'idle' as UpdateStatus,
	/** Version of the available update, for the chip's tooltip. Empty until one is found. */
	version: '',
	/** Download progress 0–100 while `status === 'downloading'`. */
	progress: 0,
	/** Last failure message, surfaced in the chip's tooltip so a stuck update isn't silent. */
	error: ''
});

/** Ask the release endpoint whether a newer signed build exists. Silent + non-fatal: a failed check
 *  (offline, endpoint down) leaves the app fully usable, just without an update prompt. */
export async function checkForUpdate(): Promise<void> {
	if (detectPlatform() !== Platform.Desktop) return; // no self-update on web/headless
	try {
		const { check } = await import('@tauri-apps/plugin-updater');
		const found = await check();
		if (found) {
			pending = found;
			updater.version = found.version;
			updater.status = 'available';
		}
	} catch (e) {
		updater.error = e instanceof Error ? e.message : String(e);
	}
}

/** Download + install the pending update, reporting progress, then relaunch into the new version. On
 *  failure it drops back to 'available' so the user can retry from the same chip. */
/** Dev-only: light the update chip without a published release, to preview its styling/states. Reach
 *  it from `?dev-update` in the shell. No-op in production. */
export function simulateUpdateAvailable(): void {
	if (!import.meta.env.DEV) return;
	pending = null;
	fakeUpdate = true;
	updater.version = '0.0.0-dev';
	updater.status = 'available';
}

// Dev-only: walk the reactive fields through download → install without a real handle or relaunch.
async function runFakeInstall(): Promise<void> {
	updater.status = 'downloading';
	for (let p = 0; p <= 100; p += 10) {
		updater.progress = p;
		await new Promise((resolve) => setTimeout(resolve, 120));
	}
	updater.status = 'installing';
}

export async function installUpdate(): Promise<void> {
	if (fakeUpdate) return runFakeInstall();
	if (!pending) return;
	updater.status = 'downloading';
	updater.progress = 0;
	updater.error = '';
	try {
		let total = 0;
		let received = 0;
		await pending.downloadAndInstall((event) => {
			switch (event.event) {
				case 'Started':
					total = event.data.contentLength ?? 0;
					break;
				case 'Progress':
					received += event.data.chunkLength;
					updater.progress = total ? Math.round((received / total) * 100) : 0;
					break;
				case 'Finished':
					updater.status = 'installing';
					break;
			}
		});
		const { relaunch } = await import('@tauri-apps/plugin-process');
		await relaunch();
	} catch (e) {
		updater.status = 'available';
		updater.error = e instanceof Error ? e.message : String(e);
	}
}
