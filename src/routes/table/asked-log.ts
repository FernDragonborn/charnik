/*
 * The GM's log of asks — who was asked what, and what came back — kept through a page that loads
 * again. It is the page's own: the DC a roll is held to is the GM's and never crosses the wire, so
 * Rust cannot hand it back with the rest of the table (`docs/internals/table-link.md` ▸ Staying
 * seated). It is kept in sessionStorage, which lasts exactly as long as a table does: through a
 * reload, and not past the app's window.
 */
import { z } from 'zod';
import type { TableId } from '$lib/table-link/types';
import { tableRequestSchema, tableRollSchema } from '$lib/table-link/wire-schema';

export const ASK_STATUS = {
	pending: 'pending',
	accepted: 'accepted',
	declined: 'declined',
} as const;
export type AskStatus = (typeof ASK_STATUS)[keyof typeof ASK_STATUS];

/** How many of the GM's asks are kept on screen. */
export const ASKED_MAX = 50;

const askedRowSchema = z.object({
	requestId: z.string(),
	participant: z.string(),
	name: z.string(),
	request: tableRequestSchema,
	at: z.number().int().nonnegative().exactOptional(),
	/** The DC the roll is held to on the GM's side, announced to the player or not. */
	dc: z.number().exactOptional(),
	status: z.enum(ASK_STATUS),
	roll: tableRollSchema.exactOptional(),
});
/** Something the GM asked, and what came back. */
export type AskedRow = z.infer<typeof askedRowSchema>;

const askedLogSchema = z.object({
	table: z.string(),
	rows: z.array(askedRowSchema).max(ASKED_MAX),
});

const KEY = 'charnik:table-asked';

/** Keep the log as it stands now, under the table it belongs to. */
export function keepAskedLog(table: TableId, rows: readonly AskedRow[]): void {
	try {
		sessionStorage.setItem(KEY, JSON.stringify({ table, rows }));
	} catch {
		// no sessionStorage, or no room in it: the log is then lost with the page, as a toast is
	}
}

/** The log kept for this table, or nothing: another table's, or one that is not a log, is none. */
export function readAskedLog(table: TableId): AskedRow[] {
	try {
		const kept: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
		const log = askedLogSchema.safeParse(kept);
		return log.success && log.data.table === table ? log.data.rows : [];
	} catch {
		// unreadable is the same as absent: the table itself is picked up without its log
		return [];
	}
}

/** The table is over, and its log with it. */
export function dropAskedLog(): void {
	try {
		sessionStorage.removeItem(KEY);
	} catch {
		// nothing was kept where nothing can be
	}
}
