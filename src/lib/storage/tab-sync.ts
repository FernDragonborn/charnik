/*
 * Two tabs of the web demo share one IndexedDB, and each holds a config file's sections in memory.
 * Every write is read-merge-write, but of the SECTION this tab holds — so a tab still holding the
 * state from before the other tab's change wrote it straight back. A write says so on a channel,
 * and the other tabs read the file again before anyone touches it. The desktop app has one window
 * on the data folder, where this says nothing to nobody.
 */
const CHANNEL = 'charnik-config';

let channel: BroadcastChannel | null | undefined;
function open(): BroadcastChannel | null {
	if (channel === undefined) {
		channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
		// under node (the tests) an open channel would keep the process alive; a browser has no unref
		if (channel && 'unref' in channel && typeof channel.unref === 'function') channel.unref();
	}
	return channel;
}

/** Tell the other tabs this file was just written. */
export function announceConfigWrite(path: string): void {
	open()?.postMessage(path);
}

/** Run `reload` whenever ANOTHER tab writes this file (a channel never echoes to its sender). */
export function onConfigWrittenElsewhere(path: string, reload: () => void): () => void {
	const ch = open();
	if (!ch) return () => {};
	const listener = (event: MessageEvent) => {
		if (event.data === path) reload();
	};
	ch.addEventListener('message', listener);
	return () => ch.removeEventListener('message', listener);
}
