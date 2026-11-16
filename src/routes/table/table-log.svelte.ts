/*
 * The table's log as this app holds it: the records Rust kept and checked, in the order of their
 * times and without the hidden ones — and the rolls this app's sheet makes, written into it
 * (`docs/internals/table-link.md` ▸ The table's log).
 */
import type { RollLogEntry } from '$lib/combat/roll';
import {
	LOG_BODY,
	TABLE_ROLE,
	type Audience,
	type Delivery,
	type LogBody,
	type LogRecord,
	type RecordEvent,
	type TableRole,
} from '$lib/table-link/types';
import { ROLL_NAME_MAX } from '$lib/table-link/wire-schema';
import { tableRollOf } from './requested-roll';

type RollBody = Extract<LogBody, { kind: typeof LOG_BODY.roll }>;

/** A roll in the log, with who wrote it. */
export interface LogLine {
	record: LogRecord & { body: RollBody };
	/** The name the GM let its author in under; null for the GM's own and for this app's own. */
	name: string | null;
	mine: boolean;
}

/** What the log needs of the seat it is written from. */
export interface TableLogHost {
	role: TableRole;
	write(body: LogBody): Promise<Delivery> | undefined;
}

/** Rust keeps a table's newest 500 records; the page holds as many rolls. */
const LINES_MAX = 500;
// control characters, and the marks that reorder the text around them — what Rust's `plain_text` drops
const UNPRINTABLE = /[\p{Cc}‪-‮⁦-⁩]/u;

/** A roll's words as Rust will keep them: nothing unprintable, at most forty characters. */
export const plainRollName = (text: string): string =>
	[...text]
		.filter((char) => !UNPRINTABLE.test(char))
		.slice(0, ROLL_NAME_MAX)
		.join('')
		.trim();

const recordId = (author: string, seq: number): string => `${author}#${seq}`;

export class TableLog {
	constructor(private host: () => TableLogHost) {}

	/** Oldest first. A hidden roll is not among them, and a hide that arrives before its roll keeps
	 *  that roll out when it comes. */
	private lines = $state<LogLine[]>([]);
	private hidden = $state<string[]>([]);

	/** What the log shows, newest first. */
	get shown(): LogLine[] {
		return this.lines.toReversed();
	}

	take = (event: RecordEvent): void => {
		const { record } = event;
		if (record.body.kind === LOG_BODY.hide) {
			const id = recordId(record.body.author, record.body.seq);
			// the roll goes, and its place with it; the hide is kept for a roll that arrives after it
			this.lines = this.lines.filter(
				(line) => recordId(line.record.author, line.record.seq) !== id,
			);
			if (!this.hidden.includes(id)) this.hidden = [...this.hidden, id].slice(-LINES_MAX);
			return;
		}
		const id = recordId(record.author, record.seq);
		if (this.hidden.includes(id)) return;
		if (this.lines.some((line) => recordId(line.record.author, line.record.seq) === id)) return;
		const line: LogLine = {
			record: { ...record, body: record.body },
			name: event.name ?? null,
			mine: event.mine,
		};
		this.lines = [...this.lines, line].sort((a, b) => a.record.at - b.record.at).slice(-LINES_MAX);
	};

	clear = (): void => {
		this.lines = [];
		this.hidden = [];
	};

	/** Write the rolls the open sheet just made, to whom the person said. */
	share = (entries: readonly RollLogEntry[], to: Audience): void => {
		for (const entry of entries) {
			const text = plainRollName(entry.label);
			if (!text) continue;
			// a key that needs values to be worded is not one the other side can word
			const key = entry.labelKey && !entry.labelValues ? { key: entry.labelKey } : {};
			void this.host().write({
				kind: LOG_BODY.roll,
				name: { text, ...key },
				roll: tableRollOf(entry),
				to,
			});
		}
	};

	/** The GM hides anyone's roll, a player their own. */
	canHide = (line: LogLine): boolean => this.host().role === TABLE_ROLE.gm || line.mine;

	hide = (line: LogLine): void => {
		if (!this.canHide(line)) return;
		void this.host().write({
			kind: LOG_BODY.hide,
			author: line.record.author,
			seq: line.record.seq,
		});
	};
}
