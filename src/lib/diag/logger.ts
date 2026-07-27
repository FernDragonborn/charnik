/*
 * The single diagnostics logging seam. Every part of the app logs through `logger.*`; nobody calls
 * raw `console` (enforced by the `no-console` eslint rule, allowlisted only here + `$lib/diag/**`).
 *
 * Two impls behind one signature — the same platform split as `Storage` (provider.ts):
 *   - Desktop (Tauri): forward to the official `tauri-plugin-log`, which writes a rotating file in
 *     the OS app-log dir + echoes to Stdout/Webview. The plugin is DYNAMICALLY imported inside
 *     `initDiag()` (mirrors `updater.svelte.ts`) so the web/Pages bundle never statically pulls
 *     `@tauri-apps/plugin-log` (it doesn't exist there). This is the ONE module allowed to import
 *     Tauri outside the Storage seam (eslint Tauri-fence allowlist).
 *   - Web / headless: no file sink, so an always-on in-memory RING BUFFER (last N entries) is the
 *     only record — it's what the bug-report bundle reads. Dev also mirrors to `console`.
 *
 * REDACTION (docs/AUDIT.md DIAG-1): the plugin has no built-in redaction, so this facade must never
 * be handed character names / notes / free-text or raw file contents — only ids, types, levels,
 * counts, error messages + stacks. `ctx` is for those structured breadcrumbs; callers keep PII out.
 */
import { detectPlatform, Platform } from '$lib/storage/provider';
import { errText } from '$lib/util/format';

/** Syslog-ish levels, matching the Tauri plugin. Ordered by severity for release-level filtering. */
export enum LogLevel {
	Trace = 'trace',
	Debug = 'debug',
	Info = 'info',
	Warn = 'warn',
	Error = 'error'
}

/** One recorded log line. `ctx` holds structured, PII-free breadcrumbs (ids/counts/error text). */
export interface LogEntry {
	ts: number;
	level: LogLevel;
	msg: string;
	ctx?: Record<string, unknown>;
}

/** Cap on the in-memory ring so a long session can't grow logs without bound. */
const RING_CAPACITY = 500;
const ring: LogEntry[] = [];

/** The desktop sink, wired by `initDiag()`. Null on web/headless and before init on desktop. */
let forwardToPlugin: ((entry: LogEntry) => void) | null = null;

function record(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
	const entry: LogEntry = { ts: Date.now(), level, msg, ...(ctx ? { ctx } : {}) };
	ring.push(entry);
	if (ring.length > RING_CAPACITY) ring.shift();
	if (forwardToPlugin) {
		forwardToPlugin(entry); // desktop: plugin owns Stdout/Webview/file, so don't also console here
	} else if (import.meta.env.DEV) {
		mirrorToConsole(entry); // web/headless dev, or desktop before initDiag runs
	}
}

// The dev/web mirror sink — the ONE deliberate console site (the `no-console` rule exempts
// `$lib/diag/**` for exactly this).
function mirrorToConsole(entry: LogEntry): void {
	const fn =
		entry.level === LogLevel.Error
			? console.error
			: entry.level === LogLevel.Warn
				? console.warn
				: console.log;
	fn(`[${entry.level}] ${entry.msg}`, entry.ctx ?? '');
}

/** The app-wide logger. Prefer structured `ctx` over interpolating values into `msg`. */
export const logger = {
	trace: (msg: string, ctx?: Record<string, unknown>) => record(LogLevel.Trace, msg, ctx),
	debug: (msg: string, ctx?: Record<string, unknown>) => record(LogLevel.Debug, msg, ctx),
	info: (msg: string, ctx?: Record<string, unknown>) => record(LogLevel.Info, msg, ctx),
	warn: (msg: string, ctx?: Record<string, unknown>) => record(LogLevel.Warn, msg, ctx),
	error: (msg: string, ctx?: Record<string, unknown>) => record(LogLevel.Error, msg, ctx)
};

/** The recent log tail (newest last), for the bug-report bundle. Copy so callers can't mutate the
 *  ring. `max` clamps to at most the whole buffer. */
export function getLogTail(max = 200): LogEntry[] {
	return ring.slice(-max);
}

/** Format `ctx` for the plugin, which takes only string key-values. Objects/arrays are JSON'd. */
function ctxToKeyValues(ctx?: Record<string, unknown>): Record<string, string> | undefined {
	if (!ctx) return undefined;
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(ctx)) {
		out[k] = typeof v === 'string' ? v : JSON.stringify(v);
	}
	return out;
}

/** Wire the desktop file sink. No-op (leaving the ring-only web behaviour) off desktop. Best-effort:
 *  a plugin that fails to load must never break app startup — logging just stays ring-only. Idempotent. */
export async function initDiag(): Promise<void> {
	if (forwardToPlugin || detectPlatform() !== Platform.Desktop) return;
	try {
		const log = await import('@tauri-apps/plugin-log');
		// Capture third-party `console.*` (svelte-sonner, papaparse, quickjs…) into the same file. Our
		// own logging already goes through `forwardToPlugin`, so this only adds the libraries' noise.
		void log.attachConsole();
		const sink: Record<LogLevel, (m: string, o?: { keyValues?: Record<string, string> }) => void> =
			{
				[LogLevel.Trace]: log.trace,
				[LogLevel.Debug]: log.debug,
				[LogLevel.Info]: log.info,
				[LogLevel.Warn]: log.warn,
				[LogLevel.Error]: log.error
			};
		forwardToPlugin = (entry) => {
			const kv = ctxToKeyValues(entry.ctx);
			sink[entry.level](entry.msg, kv ? { keyValues: kv } : undefined);
		};
	} catch (e) {
		// Ring buffer already holds everything; a missing plugin just means no file sink.
		logger.warn('diag: log plugin unavailable, staying ring-only', { error: errText(e) });
	}
}

/** Desktop only: reveal the rotating log-file folder (OS app-log dir) in the file manager, so a user
 *  can attach the full log to a bug report. No-op off desktop (web has no file sink). Best-effort. */
export async function openLogDir(): Promise<void> {
	if (detectPlatform() !== Platform.Desktop) return;
	try {
		const { appLogDir } = await import('@tauri-apps/api/path');
		const { openPath } = await import('@tauri-apps/plugin-opener');
		await openPath(await appLogDir());
	} catch (e) {
		logger.warn('diag: could not open log dir', { error: errText(e) });
	}
}

/** Route otherwise-lost uncaught errors + unhandled rejections into the logger. Call once at
 *  startup (the shell). Returns a teardown that removes both listeners. */
export function captureGlobalErrors(): () => void {
	const onError = (event: ErrorEvent) => {
		logger.error('uncaught error', {
			message: event.message,
			source: event.filename,
			line: event.lineno,
			stack: event.error instanceof Error ? event.error.stack : undefined
		});
	};
	const onRejection = (event: PromiseRejectionEvent) => {
		logger.error('unhandled rejection', { reason: errText(event.reason) });
	};
	window.addEventListener('error', onError);
	window.addEventListener('unhandledrejection', onRejection);
	return () => {
		window.removeEventListener('error', onError);
		window.removeEventListener('unhandledrejection', onRejection);
	};
}
