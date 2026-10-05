/*
 * A character's roll log: `characters/<slug>/log.jsonl`, one JSON object per line, append-only and
 * kept OUT of `character.json` so a long campaign cannot bloat the save. Every write here rewrites
 * the whole file, so each takes its turn on the character's own queue (`repository.ts` ▸ `enqueue`).
 */
import type { Storage } from '../storage/types';
import { dirOf, enqueue } from './repository';
// TYPE-only: the log line and the in-session entry are the SAME record, so the type comes from where
// the roll lives. Erased at build — no runtime edge from the character layer into combat.
import type { RollLogEntry } from '../combat/roll';

const logOf = (slug: string) => `${dirOf(slug)}/log.jsonl`;

/** The kinds of line `log.jsonl` holds. `roll` is the only one written today — see `LogEntry.kind`. */
export const LOG_KIND = { roll: 'roll' } as const;
type LogKind = (typeof LOG_KIND)[keyof typeof LOG_KIND];

export interface LogEntry {
	t: number; // epoch ms — equals `roll.at` for anything written since 2026-08-21
	/** What KIND of line this is. One member so far — every writer has always said `roll`, while the
	 *  type advertised a taxonomy ("attack" | "save" | "check" | …) nothing ever wrote, so a reader
	 *  could not trust it. A named member rather than a free string, per
	 *  AGENTS.md ▸ Taste (open enums, never booleans): reviving the taxonomy means adding a member here, and every switch over it
	 *  then fails to compile until it handles the new one. */
	kind: LogKind;
	label: string;
	/** The COMPLETE in-session record: dice, per-type damage, the advantage pair, the provenance
	 *  note. The line used to carry a flattened summary instead, so a reload silently returned a
	 *  poorer log than the one on screen — an attack without its damage, an advantaged roll without
	 *  its pair. Absent on lines written before that. */
	roll?: RollLogEntry;
	/** The flattened total + rendered expression. LEGACY: still written so a line stays readable by
	 *  an older build, and still read for lines that predate `roll`. Nothing new should grow here. */
	result?: number;
	detail?: string;
}

/** The stored line for one completed roll: the WHOLE record, plus the flattened summary an older
 *  build reads. One builder, so an append and a revision can never write different shapes. */
export function logLineFor(roll: RollLogEntry): LogEntry {
	return {
		t: roll.at ?? Date.now(),
		kind: LOG_KIND.roll,
		label: roll.label,
		roll,
		...(Number.isFinite(roll.total) ? { result: roll.total } : {}),
		...(roll.expr ? { detail: roll.expr } : {}),
	};
}

/** Cap on retained roll-log lines on disk — the log is a rolling history, not an archive, so it
 *  can't grow without bound (B4). Older lines drop off the front when the file exceeds this.
 *  100 is enough to reopen the app and see the session before, at ~30–66 KB (a structured attack
 *  line is 678 B, a plain save 296 B). It also bounds the cost of a ROLL: `writeLogLine` reads and
 *  rewrites the whole file on every append, so the cap is the per-roll IO too. Matches
 *  `ROLL_LOG_MAX`, the in-session cap — a memory log deeper than the disk one loses half of itself
 *  on reload with nothing said. */
const LOG_MAX_LINES = 100;

/** Append one roll-log line (`log.jsonl`, one JSON object per line), rotating out the oldest lines
 *  past `LOG_MAX_LINES` so the file stays bounded. `appendLog` is read-modify-write and
 *  fire-and-forget from the combat view, so it takes its turn on the character's queue: two fast
 *  rolls would otherwise both read the same `prev` and the second write would clobber the first. */
export function appendLog(storage: Storage, slug: string, entry: LogEntry): Promise<void> {
	return enqueue(slug, () => writeLogLine(storage, slug, entry));
}

async function writeLogLine(storage: Storage, slug: string, entry: LogEntry): Promise<void> {
	// "there is no log yet" and "the log is there and could not be read" are different answers, and the
	// recovery for the first — rewrite the file from this one entry — destroys the second's hundred
	// lines. `exists` is on the interface, so the branch can ask instead of assuming.
	const path = logOf(slug);
	const prev = (await storage.exists(path)) ? await storage.read(path) : '';
	const lines = prev ? prev.split('\n').filter((l) => l.trim()) : [];
	lines.push(JSON.stringify(entry));
	const kept = lines.length > LOG_MAX_LINES ? lines.slice(lines.length - LOG_MAX_LINES) : lines;
	await storage.write(logOf(slug), kept.join('\n') + '\n');
}

/** Replace the line a roll already wrote (matched on its timestamp), for an AMENDMENT: advantage
 *  applied after the fact, a reroll. Appending instead would record the same roll twice, and leaving
 *  it alone would mean the correction dies with the session. Runs on the same per-character queue as
 *  `appendLog`, since both rewrite the whole file. No-op when the line has rotated off. */
export function reviseLog(storage: Storage, slug: string, entry: LogEntry): Promise<void> {
	return enqueue(slug, () => rewriteLogLine(storage, slug, entry));
}

async function rewriteLogLine(storage: Storage, slug: string, entry: LogEntry): Promise<void> {
	let prev: string;
	try {
		prev = await storage.read(logOf(slug));
	} catch {
		return; // no log yet — nothing to revise
	}
	const lines = prev.split('\n').filter((l) => l.trim());
	const i = lines.findIndex((l) => l.includes(`"t":${entry.t}`) && parsedT(l) === entry.t);
	if (i === -1) return;
	lines[i] = JSON.stringify(entry);
	await storage.write(logOf(slug), lines.join('\n') + '\n');
}

/** The `t` of one stored line, or NaN if it doesn't parse — the cheap `includes` above narrows the
 *  candidates, this confirms one (a damage total of 1755... could contain the digits by accident). */
function parsedT(line: string): number {
	try {
		return (JSON.parse(line) as LogEntry).t;
	} catch {
		return NaN;
	}
}

/** Read the whole roll log, newest first. Bad lines are skipped. */
export async function readLog(storage: Storage, slug: string): Promise<LogEntry[]> {
	let raw: string;
	try {
		raw = await storage.read(logOf(slug));
	} catch {
		return [];
	}
	const out: LogEntry[] = [];
	for (const line of raw.split('\n')) {
		if (!line.trim()) continue;
		try {
			out.push(JSON.parse(line) as LogEntry);
		} catch {
			/* skip corrupt line */
		}
	}
	return out.reverse();
}
