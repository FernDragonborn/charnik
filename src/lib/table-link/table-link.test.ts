/*
 * The seam without a Tauri: a build with no table says so, the desktop adapter hands Rust exactly
 * what a seat was told and reads a missing command as no table at all, and nothing a peer sent
 * reaches a listener unless it is the shape it claims.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deriveSheet } from '$lib/character/derive';
import { demoCharacter } from '$lib/demo/sheet';
import { loadPacks } from '../../test-support/real-content';
import {
	CLOSE_REASON,
	CONNECTION,
	DELIVERY,
	RELAY_MODE,
	REQUESTED_ROLL,
	SEATING,
	TABLE_ANSWER,
	TABLE_EVENT,
	TABLE_REQUEST,
	UNAVAILABLE,
} from './types';
import type { GmEvent, PlayerEvent } from './types';
import { tableViewOf } from './view';
import { LABEL_MAX, NAME_MAX, tableEventSchema, tableViewSchema } from './wire-schema';

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

const NO_TABLE = { status: SEATING.unavailable, reason: UNAVAILABLE.noTable };
const HOSTING = { name: 'Friday game', relay: { mode: RELAY_MODE.n0 }, locale: 'en' };
const JOINING = { invite: 'an invite', name: 'Lira', locale: 'en' };
const seatedAs = (seat: { invite?: string; code?: string }) => ({
	status: SEATING.seated,
	table: 'table-1',
	invite: seat.invite ?? null,
	code: seat.code ?? null,
});

const graph = await loadPacks('srd-2024');
const character = demoCharacter();
const sheet = deriveSheet(character, graph);
const view = tableViewOf(character, sheet);

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
		// an element clobbering the name is not Tauri: only its object carries `invoke`
		vi.stubGlobal('window', { __TAURI_INTERNALS__: { id: '__TAURI_INTERNALS__' } });
		expect(getTableLink()).toBe(noopTableLink);
		vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke: () => {} } });
		expect(getTableLink()).toBe(tauriTableLink);
	});

	it('gives no seat, and calls nothing to find that out', async () => {
		expect(await noopTableLink.host(HOSTING)).toEqual(NO_TABLE);
		expect(await noopTableLink.join(JOINING)).toEqual(NO_TABLE);
		expect(invoke).not.toHaveBeenCalled();
	});
});

describe('the desktop table link', () => {
	it('reads a command that is not there as no table', async () => {
		invoke.mockRejectedValue('Command table_link_host not found');
		expect(await tauriTableLink.host(HOSTING)).toEqual(NO_TABLE);
		expect(await tauriTableLink.join(JOINING)).toEqual(NO_TABLE);
	});

	it('says why a table could not be opened', async () => {
		const refused = { status: SEATING.unavailable, reason: UNAVAILABLE.relayUnreachable };
		invoke.mockResolvedValue(refused);
		expect(await tauriTableLink.host(HOSTING)).toEqual(refused);
		expect(invoke).toHaveBeenCalledExactlyOnceWith('table_link_host', HOSTING);
	});

	it('gives a GM a seat that asks, and hears only its own table', async () => {
		invoke.mockResolvedValueOnce(seatedAs({ invite: 'charnik-table:abc' }));
		const seating = await tauriTableLink.host(HOSTING);
		if (seating.status !== SEATING.seated) throw new Error('not seated');
		const { seat } = seating;
		expect(seat.table).toBe('table-1');
		expect(seat.invite).toBe('charnik-table:abc');

		const request = { kind: TABLE_REQUEST.roll, roll: REQUESTED_ROLL.skill, id: 'stealth', dc: 15 };
		invoke.mockResolvedValueOnce(DELIVERY.delivered);
		const asked = await seat.request('p-1', request);
		if (asked.delivery !== DELIVERY.delivered) throw new Error('not delivered');
		expect(invoke).toHaveBeenLastCalledWith('table_link_request', {
			table: 'table-1',
			participant: 'p-1',
			requestId: asked.requestId,
			request,
		});
		invoke.mockResolvedValueOnce(DELIVERY.notDelivered);
		expect(await seat.request('p-9', request)).toEqual({ delivery: DELIVERY.notDelivered });

		const heard: GmEvent[] = [];
		const stop = await seat.subscribe((event) => heard.push(event));
		const left = { kind: TABLE_EVENT.participantLeft, table: 'table-1', participant: 'p-1' };
		push(left);
		push({ ...left, table: 'table-2' });
		push({ kind: TABLE_EVENT.request, table: 'table-1', requestId: 'r-1', request });
		push({ kind: TABLE_EVENT.view, table: 'table-1', participant: 'p-1', view });
		expect(heard).toEqual([
			left,
			{ kind: TABLE_EVENT.view, table: 'table-1', participant: 'p-1', view },
		]);
		stop();
		push(left);
		expect(heard).toHaveLength(2);

		invoke.mockResolvedValueOnce('charnik-table:new');
		expect(await seat.setDoor(true)).toBe('charnik-table:new');
		expect(invoke).toHaveBeenLastCalledWith('table_link_door', { table: 'table-1', open: true });
		invoke.mockResolvedValueOnce(null);
		await seat.dismiss('p-1');
		expect(invoke).toHaveBeenLastCalledWith('table_link_dismiss', {
			table: 'table-1',
			participant: 'p-1',
		});
		invoke.mockResolvedValueOnce(null);
		await seat.leave();
		expect(invoke).toHaveBeenLastCalledWith('table_link_leave', { table: 'table-1' });
	});

	it('gives a player a seat that publishes and answers, and hears requests', async () => {
		invoke.mockResolvedValueOnce(seatedAs({ code: '123-456' }));
		const seating = await tauriTableLink.join(JOINING);
		if (seating.status !== SEATING.seated) throw new Error('not seated');
		const { seat } = seating;
		expect(seat.code).toBe('123-456');

		invoke.mockResolvedValueOnce(DELIVERY.delivered);
		expect(await seat.publish(character, sheet)).toBe(DELIVERY.delivered);
		expect(invoke).toHaveBeenLastCalledWith('table_link_publish', { table: 'table-1', view });

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
		const closed = {
			kind: TABLE_EVENT.connection,
			table: 'table-1',
			state: CONNECTION.closed,
			reason: CLOSE_REASON.dismissed,
		};
		push(asked);
		push({ kind: TABLE_EVENT.participantLeft, table: 'table-1', participant: 'p-2' });
		push(closed);
		expect(heard).toEqual([asked, closed]);
	});

	it('answers not delivered when a call cannot be made', async () => {
		invoke.mockResolvedValueOnce(seatedAs({ code: '123-456' }));
		const seating = await tauriTableLink.join(JOINING);
		if (seating.status !== SEATING.seated) throw new Error('not seated');
		invoke.mockRejectedValueOnce('the window is closing');
		const answer = { outcome: TABLE_ANSWER.accepted };
		expect(await seating.seat.respond('r-1', answer)).toBe(DELIVERY.notDelivered);
	});
});

describe("the table's view of a character", () => {
	it('is the sheet a GM reads across the table, numbers explained', () => {
		expect(tableViewSchema.parse(view)).toEqual(view);
		expect(view.name).toBe(character.build.name);
		expect(view.ac.value).toBe(sheet.ac.value);
		expect(view.ac.trace).toEqual(sheet.ac.trace);
		expect(view.abilities.dex.save.value).toBe(sheet.abilities.dex.save.value);
		expect(view.skills.stealth?.value).toBe(sheet.skills.stealth.value);
		expect(view.hp.current).toBe(character.play.hp.current);
	});

	it('carries nothing a player would not say aloud', () => {
		expect(Object.keys(view).sort()).toEqual(Object.keys(tableViewSchema.shape).sort());
		for (const kept of ['inventory', 'notes', 'build', 'portrait', 'resolvedEffects', 'castCtx'])
			expect(view).not.toHaveProperty(kept);
	});

	it('cuts a long name and a long label instead of losing the seat', () => {
		const wordy = {
			...character,
			build: { ...character.build, name: 'N'.repeat(NAME_MAX * 3) },
			play: {
				...character.play,
				effects: [{ iid: 'e-1', label: 'L'.repeat(LABEL_MAX * 3), effects: [], positive: true }],
			},
		};
		const cut = tableViewOf(wordy, deriveSheet(wordy, graph));
		expect(tableViewSchema.safeParse(cut).success).toBe(true);
		expect(cut.name).toHaveLength(NAME_MAX);
		expect(cut.effects[0]).toHaveLength(LABEL_MAX);
	});
});

describe('what a peer sent', () => {
	const event = (kind: string, rest: object) => ({ kind, table: 'table-1', ...rest });
	const viewEvent = (changed: object) =>
		event(TABLE_EVENT.view, { participant: 'p-1', view: { ...view, ...changed } });
	const requestEvent = (request: object) =>
		event(TABLE_EVENT.request, { requestId: 'r-1', request });
	const fits = (payload: unknown) => tableEventSchema.safeParse(payload).success;

	it('is believed when it is the shape it claims', () => {
		expect(fits(viewEvent({}))).toBe(true);
		expect(fits(requestEvent({ kind: TABLE_REQUEST.heal, amount: 5 }))).toBe(true);
		const roll = {
			kind: TABLE_REQUEST.roll,
			roll: REQUESTED_ROLL.savingThrow,
			id: 'dex',
		};
		expect(fits(requestEvent(roll))).toBe(true);
		expect(fits(requestEvent({ ...roll, dc: 15 }))).toBe(true);
		// an absent field is absent, never null
		expect(fits(requestEvent({ ...roll, dc: null }))).toBe(false);
	});

	it('is dropped when a number is not one a sheet can hold', () => {
		expect(fits(viewEvent({ hp: { current: Number.MAX_SAFE_INTEGER, max: 1, temp: 0 } }))).toBe(
			false,
		);
		expect(fits(viewEvent({ hp: { current: -5, max: 1, temp: 0 } }))).toBe(false);
		expect(fits(viewEvent({ ac: { value: Infinity, trace: [] } }))).toBe(false);
		expect(fits(viewEvent({ level: 1.5 }))).toBe(false);
	});

	it('is dropped when a text or a list is longer than the screen it is for', () => {
		expect(fits(viewEvent({ name: 'x'.repeat(NAME_MAX + 1) }))).toBe(false);
		expect(fits(viewEvent({ conditions: Array.from({ length: 500 }, () => 'poisoned') }))).toBe(
			false,
		);
		const trace = Array.from({ length: 500 }, () => view.ac.trace[0]);
		expect(fits(viewEvent({ ac: { value: 10, trace } }))).toBe(false);
		expect(fits(viewEvent({ conditions: ['<img src=x onerror=alert(1)>'] }))).toBe(false);
	});

	it('is dropped when a request carries more than ids and numbers', () => {
		expect(
			fits(requestEvent({ kind: TABLE_REQUEST.effect, id: 'poisoned', tokens: ['ac+5'] })),
		).toBe(false);
		expect(fits(requestEvent({ kind: 'formula', formula: '100d100' }))).toBe(false);
		expect(fits(requestEvent({ kind: TABLE_REQUEST.damage, amount: 1e9, type: null }))).toBe(false);
		expect(fits(requestEvent({ kind: TABLE_REQUEST.effect, id: 'Not A Slug' }))).toBe(false);
	});

	it('never reaches a listener unless it fits', async () => {
		invoke.mockResolvedValueOnce(seatedAs({ invite: 'i' }));
		const seating = await tauriTableLink.host(HOSTING);
		if (seating.status !== SEATING.seated) throw new Error('not seated');
		const heard: GmEvent[] = [];
		await seating.seat.subscribe((heardEvent) => heard.push(heardEvent));
		push(viewEvent({ name: 'x'.repeat(NAME_MAX + 1) }));
		push({ kind: 'unknown', table: 'table-1' });
		push('not an object');
		expect(heard).toEqual([]);
	});
});
