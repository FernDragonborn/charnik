/*
 * The seam without a Tauri: a build with no table says so, and the desktop adapter hands Rust
 * exactly what a seat was told and reads a missing command as no table at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	DELIVERY,
	REQUESTED_ROLL,
	SEATING,
	TABLE_ANSWER,
	TABLE_EVENT,
	TABLE_REQUEST,
} from './types';
import type { GmEvent, PlayerEvent } from './types';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

type Handler = (event: { payload: unknown }) => void;
const handlers = new Set<Handler>();
const push = (payload: unknown): void => {
	for (const handler of handlers) handler({ payload });
};
vi.mock('@tauri-apps/api/event', () => ({
	listen: (_channel: string, handler: Handler) => {
		handlers.add(handler);
		return Promise.resolve(() => handlers.delete(handler));
	},
}));

const { getTableLink } = await import('./provider');
const { noopTableLink } = await import('./noop');
const { tauriTableLink } = await import('./tauri');

const UNAVAILABLE = { status: SEATING.unavailable };

beforeEach(() => {
	invoke.mockReset();
	handlers.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('a build with no table', () => {
	it('is what everything but the desktop app gets', () => {
		expect(getTableLink()).toBe(noopTableLink);
		vi.stubGlobal('window', {});
		expect(getTableLink()).toBe(noopTableLink);
		vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
		expect(getTableLink()).toBe(tauriTableLink);
	});

	it('gives no seat, and calls nothing to find that out', async () => {
		expect(await noopTableLink.host('Friday game')).toEqual(UNAVAILABLE);
		expect(await noopTableLink.join('an invite')).toEqual(UNAVAILABLE);
		expect(invoke).not.toHaveBeenCalled();
	});
});

describe('the desktop table link', () => {
	it('reads a command that is not there as no table', async () => {
		invoke.mockRejectedValue('Command table_link_host not found');
		expect(await tauriTableLink.host('Friday game')).toEqual(UNAVAILABLE);
		expect(await tauriTableLink.join('an invite')).toEqual(UNAVAILABLE);
	});

	it('reads a build with no transport as no table', async () => {
		invoke.mockResolvedValue(null);
		expect(await tauriTableLink.host('Friday game')).toEqual(UNAVAILABLE);
		expect(invoke).toHaveBeenCalledExactlyOnceWith('table_link_host', { name: 'Friday game' });
	});

	it('gives a GM a seat that asks, and hears only its own table', async () => {
		invoke.mockResolvedValueOnce('table-1');
		const seating = await tauriTableLink.host('Friday game');
		if (seating.status !== SEATING.seated) throw new Error('not seated');
		const { seat } = seating;
		expect(seat.table).toBe('table-1');

		const request = { kind: TABLE_REQUEST.roll, roll: REQUESTED_ROLL.skill, id: 'stealth', dc: 15 };
		invoke.mockResolvedValueOnce(DELIVERY.delivered);
		expect(await seat.request('p-1', request)).toBe(DELIVERY.delivered);
		expect(invoke).toHaveBeenLastCalledWith('table_link_request', {
			table: 'table-1',
			participant: 'p-1',
			request,
		});

		const heard: GmEvent[] = [];
		const stop = await seat.subscribe((event) => heard.push(event));
		const left = { kind: TABLE_EVENT.participantLeft, table: 'table-1', participant: 'p-1' };
		push(left);
		push({ ...left, table: 'table-2' });
		push({ kind: TABLE_EVENT.request, table: 'table-1', requestId: 'r-1', request });
		expect(heard).toEqual([left]);
		stop();
		push(left);
		expect(heard).toHaveLength(1);

		invoke.mockResolvedValueOnce(null);
		await seat.leave();
		expect(invoke).toHaveBeenLastCalledWith('table_link_leave', { table: 'table-1' });
	});

	it('gives a player a seat that publishes and answers, and hears requests', async () => {
		invoke.mockResolvedValueOnce('table-1');
		const seating = await tauriTableLink.join('an invite');
		if (seating.status !== SEATING.seated) throw new Error('not seated');
		const { seat } = seating;

		const answer = { outcome: TABLE_ANSWER.declined };
		invoke.mockResolvedValueOnce(DELIVERY.delivered);
		expect(await seat.respond('r-1', answer)).toBe(DELIVERY.delivered);
		expect(invoke).toHaveBeenLastCalledWith('table_link_respond', {
			table: 'table-1',
			requestId: 'r-1',
			answer,
		});

		const heard: PlayerEvent[] = [];
		await seat.subscribe((event) => heard.push(event));
		const asked = {
			kind: TABLE_EVENT.request,
			table: 'table-1',
			requestId: 'r-1',
			request: { kind: TABLE_REQUEST.damage, amount: 7, type: 'fire' },
		};
		push(asked);
		push({ kind: TABLE_EVENT.participantLeft, table: 'table-1', participant: 'p-2' });
		expect(heard).toEqual([asked]);
	});

	it('answers not delivered when a call cannot be made', async () => {
		invoke.mockResolvedValueOnce('table-1');
		const seating = await tauriTableLink.join('an invite');
		if (seating.status !== SEATING.seated) throw new Error('not seated');
		invoke.mockRejectedValueOnce('the window is closing');
		const answer = { outcome: TABLE_ANSWER.accepted };
		expect(await seating.seat.respond('r-1', answer)).toBe(DELIVERY.notDelivered);
	});
});
