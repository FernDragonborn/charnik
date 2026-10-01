/*
 * The diagnostics wrapper around a `Storage` — every mutation leaves a breadcrumb and every failure
 * leaves an error, so a bug report says what the app was doing to the filesystem when it broke
 * (docs/internals/overview.md ▸ Storage is the only way to touch a file).
 *
 * MUTATIONS ONLY. A failed read is ordinary control flow here — `backupCharacter` reads to find out
 * whether there is anything to back up, `loadCharacter` reads to find out whether a save exists — so
 * logging those would bury the writes that actually went wrong under a list of files nobody expected
 * to be there.
 */
import { logger, redactPath } from '$lib/diag/logger';
import { errText } from '$lib/util/format';
import type { FileEntry, Storage } from './types';

/** Run one mutation, recording what it was and — on the way out — whether it landed. The path is
 *  redacted, the payload never touched: sizes are a count, contents are the user's. */
async function traced<T>(
	op: string,
	path: string,
	run: () => Promise<T>,
	extra?: Record<string, unknown>,
): Promise<T> {
	const ctx = { op, path: redactPath(path), ...extra };
	try {
		const out = await run();
		logger.debug('storage write', ctx);
		return out;
	} catch (e) {
		logger.error('storage write failed', { ...ctx, error: errText(e) });
		throw e;
	}
}

/** Wrap a storage so its mutating half is logged. Reads, listings and the watcher pass straight
 *  through. Idempotent in effect but not re-entrant by design — wrap once, at the provider. */
export function withWriteLog(inner: Storage): Storage {
	return {
		read: (path: string): Promise<string> => inner.read(path),
		readBytes: (path: string): Promise<Uint8Array> => inner.readBytes(path),
		exists: (path: string): Promise<boolean> => inner.exists(path),
		list: (dir: string): Promise<FileEntry[]> => inner.list(dir),
		watch: (dir: string, onChange: (path: string) => void): (() => void) =>
			inner.watch(dir, onChange),
		write: (path, data) =>
			traced('write', path, () => inner.write(path, data), { chars: data.length }),
		writeBytes: (path, data) =>
			traced('writeBytes', path, () => inner.writeBytes(path, data), { bytes: data.length }),
		mkdir: (path) => traced('mkdir', path, () => inner.mkdir(path)),
		remove: (path) => traced('remove', path, () => inner.remove(path)),
		rename: (from, to) =>
			traced('rename', from, () => inner.rename(from, to), { to: redactPath(to) }),
	};
}
