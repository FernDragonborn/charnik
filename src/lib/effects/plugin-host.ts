/*
 * L3 plugin HOST — discovery + consent hashing (pure logic; the reactive store and registry wiring
 * live in plugin-store.svelte.ts). Normative contract: docs/PLUGINS.md §2 (packaging) + §6
 * (lifecycle/consent) and the PLG-SEC checklist in docs/PLAN.md.
 *
 * A plugin is a folder `<dataDir>/plugins/<namespace>/` with `plugin.json` + `main.js`, read through the
 * Storage seam (own-your-data: a plugin is a folder you can read; tests use MemoryStorage).
 * Everything read here is UNTRUSTED input: the folder name is grammar-checked, the manifest is
 * strictly zod-validated (unknown keys rejected, length caps, https-only url), `main.js` is read
 * ONCE into the same buffer that gets consent-hashed AND evaluated (closes TOCTOU — PLG-SEC 12).
 *
 * Consent = `(namespace, sha256(len(main.js) ‖ main.js ‖ len(plugin.json) ‖ plugin.json))`, each file
 * LENGTH-PREFIXED (8-byte big-endian) so bytes can't migrate across the file boundary and collide
 * (§6.3). SHA-256, not the content-drift xxh64 — consent is an adversarial trust gate. The record
 * is stored OUTSIDE the dataDir (localStorage, app-side) so a merged/imported "campaign backup"
 * can carry plugin CODE but never its permission.
 */
import { z } from 'zod';
import type { Storage } from '../storage/types';

/** `main.js` size cap (docs/PLUGINS.md §2). */
const MAX_MAIN_JS_BYTES = 256 * 1024;
/** `plugin.json` sanity cap (a manifest is a few hundred bytes; anything huge is hostile). */
const MAX_MANIFEST_BYTES = 8 * 1024;
/** The namespace/folder grammar (docs/PLUGINS.md §1) — lowercase only, no `.`/`/`/`\`, so traversal is
 *  unrepresentable; ANY folder not matching is rejected (incl. Windows case-folded lookalikes:
 *  matching is exact, `My-Homebrew` never silently resolves to `my-homebrew`). */
const NAMESPACE_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Strict manifest schema (§2): unknown keys REJECTED, every field capped, url https-only. */
export const pluginManifestSchema = z.strictObject({
	api: z.literal(1),
	namespace: z.string().regex(NAMESPACE_RE),
	name: z.string().min(1).max(64),
	version: z
		.string()
		.max(32)
		.regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, 'not a semver version'),
	author: z.string().max(64).optional(),
	url: z
		.string()
		.max(256)
		.regex(/^https:\/\//, 'https:// only')
		.optional(),
	description: z.string().max(280).optional()
});
type PluginManifest = z.infer<typeof pluginManifestSchema>;

/** One discovered plugin folder. `ok` plugins are loadable (pending consent); broken ones carry
 *  the reason — surfaced in Settings/content-health, never silently skipped. */
export interface DiscoveredPlugin {
	namespace: string;
	ok: boolean;
	manifest?: PluginManifest;
	/** The full `main.js` source — the ONE buffer that is hashed and later evaluated. */
	code?: string;
	/** The §6.3 consent hash (hex), present when `ok`. */
	hash?: string;
	/** Why the folder is not loadable (bad manifest, missing file, over cap…). */
	problem?: string;
}

const enc = new TextEncoder();

/** 8-byte big-endian byte-length prefix — makes the file boundary part of what's signed (§6.3). */
function lengthPrefixed(bytes: Uint8Array): Uint8Array[] {
	const len = new Uint8Array(8);
	new DataView(len.buffer).setBigUint64(0, BigInt(bytes.length));
	return [len, bytes];
}

/** `sha256(len(mainJs) ‖ mainJs ‖ len(manifestRaw) ‖ manifestRaw)` as lowercase hex. */
export async function consentHash(mainJs: string, manifestRaw: string): Promise<string> {
	const parts = [...lengthPrefixed(enc.encode(mainJs)), ...lengthPrefixed(enc.encode(manifestRaw))];
	const buf = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let off = 0;
	for (const p of parts) {
		buf.set(p, off);
		off += p.length;
	}
	const digest = await crypto.subtle.digest('SHA-256', buf);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The plugins root inside the dataDir. */
const PLUGINS_DIR = 'plugins';

/**
 * Discover every plugin folder under `<dataDir>/plugins/`. Never throws: a missing root yields
 * `[]`; a broken folder yields an entry with `problem` (shown to the user, never silent).
 */
export async function discoverPlugins(storage: Storage): Promise<DiscoveredPlugin[]> {
	if (!(await storage.exists(PLUGINS_DIR))) return [];
	const out: DiscoveredPlugin[] = [];
	for (const entry of await storage.list(PLUGINS_DIR)) {
		if (!entry.isDir) continue;
		const namespace = entry.name;
		if (!NAMESPACE_RE.test(namespace)) {
			out.push({ namespace, ok: false, problem: 'folder name is not a valid plugin namespace' });
			continue;
		}
		out.push(await readPlugin(storage, namespace));
	}
	return out;
}

async function readPlugin(storage: Storage, namespace: string): Promise<DiscoveredPlugin> {
	const dir = `${PLUGINS_DIR}/${namespace}`;
	let manifestRaw: string;
	let code: string;
	try {
		manifestRaw = await storage.read(`${dir}/plugin.json`);
		code = await storage.read(`${dir}/main.js`);
	} catch {
		return { namespace, ok: false, problem: 'plugin.json or main.js is missing/unreadable' };
	}
	if (enc.encode(code).length > MAX_MAIN_JS_BYTES)
		return { namespace, ok: false, problem: 'main.js exceeds the 256 KB cap' };
	if (enc.encode(manifestRaw).length > MAX_MANIFEST_BYTES)
		return { namespace, ok: false, problem: 'plugin.json is implausibly large' };

	let parsed: unknown;
	try {
		parsed = JSON.parse(manifestRaw);
	} catch {
		return { namespace, ok: false, problem: 'plugin.json is not valid JSON' };
	}
	const m = pluginManifestSchema.safeParse(parsed);
	if (!m.success) {
		const first = m.error.issues[0];
		return {
			namespace,
			ok: false,
			problem: `plugin.json invalid: ${first ? `${first.path.join('.')} — ${first.message}` : 'shape'}`
		};
	}
	if (m.data.api !== 1)
		return { namespace, ok: false, problem: 'requires a newer Charnik (api > 1)' };
	if (m.data.namespace !== namespace)
		return {
			namespace,
			ok: false,
			problem: `manifest namespace "${m.data.namespace}" ≠ folder name "${namespace}"`
		};

	return {
		namespace,
		ok: true,
		manifest: m.data,
		code,
		hash: await consentHash(code, manifestRaw)
	};
}

// --- Consent + enable records (app-side storage, OUTSIDE the dataDir — PLG-SEC 12) --------------

export interface PluginPrefs {
	/** namespace → the §6.3 hash the user consented to. Hash mismatch ⇒ consent void until re-granted. */
	consent: Record<string, string>;
	/** namespace → user-enabled flag (independent of consent validity). */
	enabled: Record<string, boolean>;
	/** The global "disable all plugins" kill switch (§6.4). */
	killSwitch: boolean;
}

export const emptyPrefs = (): PluginPrefs => ({ consent: {}, enabled: {}, killSwitch: false });

const PREFS_KEY = 'charnik:plugins';

export function loadPluginPrefs(): PluginPrefs {
	if (typeof localStorage === 'undefined') return emptyPrefs();
	try {
		const raw = localStorage.getItem(PREFS_KEY);
		if (!raw) return emptyPrefs();
		const p = JSON.parse(raw) as Partial<PluginPrefs>;
		return {
			consent: typeof p.consent === 'object' && p.consent !== null ? p.consent : {},
			enabled: typeof p.enabled === 'object' && p.enabled !== null ? p.enabled : {},
			killSwitch: p.killSwitch === true
		};
	} catch {
		return emptyPrefs();
	}
}

export function savePluginPrefs(prefs: PluginPrefs): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

/** Is this discovered plugin runnable under the given prefs? (consented to EXACTLY these bytes,
 *  user-enabled, kill switch off). A hash mismatch is also the "disabled — code changed" state. */
export function isRunnable(p: DiscoveredPlugin, prefs: PluginPrefs): boolean {
	return (
		p.ok &&
		!prefs.killSwitch &&
		prefs.enabled[p.namespace] === true &&
		p.hash !== undefined &&
		prefs.consent[p.namespace] === p.hash
	);
}
