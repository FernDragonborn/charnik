/*
 * The IPC entry as hostile script in the page would use it: the webview's own `invoke`, with no
 * wrapper to be polite on its behalf. The `/dev/` probes ask the BUILT app what it refuses, and an
 * answer through `@tauri-apps/api` would be an answer about that library instead.
 */

export type Outcome = { resolved: true; value: unknown } | { resolved: false; reason: string };

/** One call through the webview's own IPC entry, settled either way. */
export async function invokeRaw(
	command: string,
	args: Record<string, unknown> = {},
): Promise<Outcome> {
	const internals: unknown = Reflect.get(window, '__TAURI_INTERNALS__');
	const invoke: unknown =
		typeof internals === 'object' && internals !== null ? Reflect.get(internals, 'invoke') : null;
	if (typeof invoke !== 'function') return { resolved: false, reason: 'no IPC entry' };
	try {
		const value: unknown = await Reflect.apply(invoke, internals, [command, args]);
		return { resolved: true, value };
	} catch (e) {
		return { resolved: false, reason: String(e) };
	}
}
