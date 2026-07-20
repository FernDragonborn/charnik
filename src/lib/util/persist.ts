/*
 * The ONE localStorage read/write boilerplate (AUDIT F10). Every persisted store repeated the same
 * SSR guard + try/catch + JSON parse/stringify around its own default/merge logic; this factors out
 * just that boilerplate. Callers still own their defaults, validation and shape — `readStored`
 * returns the raw parsed value (or null on miss/error) and they merge it over their defaults.
 */

/** Read + JSON-parse a localStorage key. SSR-safe (no `localStorage` → null) and swallows parse
 *  errors → null, so a corrupt snapshot degrades to "use defaults" rather than throwing. */
export function readStored<T>(key: string): T | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : null;
	} catch {
		return null;
	}
}

/** JSON-stringify + write a localStorage key. SSR-safe and swallows quota / private-mode errors —
 *  the session still works, the change just isn't persisted. */
export function writeStored(key: string, value: unknown): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		/* private mode / quota — not persisted, but the session continues fine */
	}
}
