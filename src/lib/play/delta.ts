/*
 * What a play action changed, as data a log line can carry and an Undo can apply in reverse.
 *
 * Read off the character before and after rather than declared by each action, for the reason
 * `changes.ts` is: every way into a change leaves the same delta. Only what moved is kept, so a line
 * in the capped log pays for the fields its act touched and no more — a rest writes its hit points,
 * slots and pools, not the character.
 *
 * Play state and what play reaches in the build (the inventory: a row dropped mid-session) are
 * covered; who the character IS is the builder's, with its own history. A list of rows that carry
 * an `iid` is compared row by row, so dropping one arrow stack does not write the whole pack twice.
 */
import { dequal } from 'dequal';
import type { Character } from '$lib/character/schema';

/** A path segment naming a row of a list by its `iid`. */
const ROW_MARK = '#';
/** The path segment that stands for a list's ORDER, when only the order moved. */
const ORDER = '#order';
/** How deep into nested objects a change is told apart: `play.hp.current`, not `play.hp`. */
const DEPTH = 3;

/** One field an action moved. `from` / `to` absent: the field (or row) was not there. */
export interface PlayChange {
	path: readonly string[];
	from?: unknown;
	to?: unknown;
	/** For a row of a list: where it stood before, so Undo puts it back in its place. */
	at?: number;
}
export type PlayDelta = readonly PlayChange[];

interface Row {
	iid: string;
}
export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
const isRow = (value: unknown): value is Row => isRecord(value) && typeof value['iid'] === 'string';
const isRowList = (value: unknown): value is Row[] => Array.isArray(value) && value.every(isRow);

const change = (path: readonly string[], from: unknown, to: unknown, at?: number): PlayChange => ({
	path,
	...(from === undefined ? {} : { from }),
	...(to === undefined ? {} : { to }),
	...(at === undefined ? {} : { at }),
});

function rowChanges(path: readonly string[], before: Row[], after: Row[]): PlayChange[] {
	const out: PlayChange[] = [];
	const afterById = new Map(after.map((row) => [row.iid, row]));
	const beforeById = new Map(before.map((row) => [row.iid, row]));
	before.forEach((row, at) => {
		const now = afterById.get(row.iid);
		if (!dequal(row, now)) out.push(change([...path, ROW_MARK + row.iid], row, now, at));
	});
	after.forEach((row, at) => {
		if (!beforeById.has(row.iid))
			out.push(change([...path, ROW_MARK + row.iid], undefined, row, at));
	});
	const kept = (rows: Row[], other: Map<string, Row>) =>
		rows.filter((row) => other.has(row.iid)).map((row) => row.iid);
	const orderBefore = kept(before, afterById);
	const orderAfter = kept(after, beforeById);
	if (!dequal(orderBefore, orderAfter)) out.push(change([...path, ORDER], orderBefore, orderAfter));
	return out;
}

function fieldChanges(path: readonly string[], before: unknown, after: unknown): PlayChange[] {
	if (dequal(before, after)) return [];
	if (isRowList(before) && isRowList(after)) return rowChanges(path, before, after);
	if (isRecord(before) && isRecord(after) && path.length < DEPTH) {
		const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
		return keys.flatMap((key) => fieldChanges([...path, key], before[key], after[key]));
	}
	return [change(path, before, after)];
}

/** A JSON copy: what the screen holds is reactive, and a delta outlives the moment it is read. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** What moved between two states of one character. */
export function playDelta(before: Character, after: Character): PlayDelta {
	return plain([
		...fieldChanges(['play'], before.play, after.play),
		...fieldChanges(['build', 'inventory'], before.build.inventory, after.build.inventory),
	]);
}

/** The value at `path` inside `root`, a row segment finding its row by `iid`. */
function read(root: unknown, path: readonly string[]): unknown {
	let at: unknown = root;
	for (const segment of path) {
		if (Array.isArray(at) && segment.startsWith(ROW_MARK) && segment !== ORDER) {
			const iid = segment.slice(ROW_MARK.length);
			at = at.find((row: unknown) => isRow(row) && row.iid === iid);
		} else if (Array.isArray(at) && segment === ORDER) {
			return at.filter(isRow).map((row) => row.iid);
		} else if (isRecord(at)) at = at[segment];
		else return undefined;
	}
	return at;
}

/** Put `value` at `path` inside a cloned root (absent `value` removes it). */
function write(root: unknown, path: readonly string[], value: unknown, rowAt?: number): void {
	const parentPath = path.slice(0, -1);
	const last = path.at(-1);
	const parent = read(root, parentPath);
	if (last === undefined) return;
	if (Array.isArray(parent) && last === ORDER && Array.isArray(value)) {
		const order = value.filter((id): id is string => typeof id === 'string');
		const byId = new Map(parent.filter(isRow).map((row) => [row.iid, row]));
		const ordered = order.flatMap((id) => {
			const row = byId.get(id);
			return row ? [row] : [];
		});
		const rest = parent.filter((row) => !isRow(row) || !order.includes(row.iid));
		parent.splice(0, parent.length, ...ordered, ...rest);
		return;
	}
	if (Array.isArray(parent) && last.startsWith(ROW_MARK)) {
		const iid = last.slice(ROW_MARK.length);
		const index = parent.findIndex((row: unknown) => isRow(row) && row.iid === iid);
		if (index >= 0) parent.splice(index, 1);
		if (value !== undefined)
			parent.splice(Math.min(rowAt ?? parent.length, parent.length), 0, value);
		return;
	}
	if (!isRecord(parent)) return;
	if (value === undefined) delete parent[last];
	else parent[last] = value;
}

/**
 * The character with `delta` taken back, or null when anything it changed has moved since — an
 * Undo then would put back a state that never was. All or nothing, like the act it reverses.
 */
export function undoDelta(character: Character, delta: PlayDelta): Character | null {
	const root = plain(character);
	for (const step of delta) if (!dequal(read(root, step.path), step.to)) return null;
	for (const step of [...delta].reverse()) write(root, step.path, step.from, step.at);
	return root;
}
