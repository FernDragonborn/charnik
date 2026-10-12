// Desktop self-update, behind the platform seam. On launch the shell runs `checkForUpdate` once; if a
// newer signed release exists the header surfaces a gold "update" chip that calls `installUpdate`
// (download → install → restart). On web/headless the checks no-op, so importing this is inert there.
//
// The page holds no update handle and passes no arguments: which release, from where, and whether an
// older one counts are decided in Rust (`src-tauri/src/self_update.rs`), and progress comes back as
// events. Neither the updater plugin's nor the process plugin's own commands are granted.
import { detectPlatform, Platform } from '$lib/storage/provider';

export type UpdateStatus = 'idle' | 'available' | 'downloading' | 'installing' | 'error';

/** The names `self_update.rs` emits under. */
const PROGRESS_EVENT = 'app-update-progress';
const INSTALLING_EVENT = 'app-update-installing';

// Dev-only preview flag: when set, `installUpdate` fakes the download instead of touching a real
// (absent) handle. Guarded everywhere by import.meta.env.DEV so it tree-shakes out of production.
let fakeUpdate = false;

/** The reactive updater state the chip reads. ANNOTATED rather than asserted per field: without a
 *  type here `status` widens to `string`, and "any string is a status" is exactly what the union
 *  exists to prevent. */
export const updater: {
	status: UpdateStatus;
	version: string;
	progress: number;
	error: string;
} = $state({
	status: 'idle',
	/** Version of the available update, for the chip's tooltip. Empty until one is found. */
	version: '',
	/** Download progress 0–100 while `status === 'downloading'`. */
	progress: 0,
	/** Last failure message, surfaced in the chip's tooltip so a stuck update isn't silent. */
	error: '',
});

/** Ask the release endpoint whether a newer signed build exists. Silent + non-fatal: a failed check
 *  (offline, endpoint down) leaves the app fully usable, just without an update prompt. */
export async function checkForUpdate(): Promise<void> {
	if (detectPlatform() !== Platform.Desktop) return; // no self-update on web/headless
	try {
		const { invoke } = await import('@tauri-apps/api/core');
		const version = await invoke<string | null>('check_app_update');
		if (version !== null) {
			updater.version = version;
			updater.status = 'available';
		}
	} catch (e) {
		updater.error = e instanceof Error ? e.message : String(e);
	}
}

/** Dev-only: light the update chip without a published release, to preview its styling/states. Reach
 *  it from `?dev-update` in the shell. No-op in production. */
export function simulateUpdateAvailable(): void {
	if (!import.meta.env.DEV) return;
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

/** Download + install the update the last check found, reporting progress; Rust restarts into the
 *  new version when it is in. On failure it drops back to 'available' so the user can retry from the
 *  same chip. */
export async function installUpdate(): Promise<void> {
	if (fakeUpdate) return runFakeInstall();
	if (updater.status !== 'available') return;
	updater.status = 'downloading';
	updater.progress = 0;
	updater.error = '';
	const stopListening: (() => void)[] = [];
	try {
		const { invoke } = await import('@tauri-apps/api/core');
		const { listen } = await import('@tauri-apps/api/event');
		stopListening.push(
			await listen<number>(PROGRESS_EVENT, (event) => (updater.progress = event.payload)),
			await listen(INSTALLING_EVENT, () => (updater.status = 'installing')),
		);
		await invoke('install_app_update');
	} catch (e) {
		updater.status = 'available';
		updater.error = e instanceof Error ? e.message : String(e);
	} finally {
		for (const stop of stopListening) stop();
	}
}
