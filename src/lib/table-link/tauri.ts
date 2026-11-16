/*
 * The desktop side of `TableLink`: the commands of `src-tauri/src/table_link/` and the channel
 * Rust pushes table events down. One of the few files allowed to import Tauri (eslint.config.js).
 *
 * Whether the build carries the feature is learned by CALLING. A build without it has no such
 * command, the call is refused, and that refusal is the same answer the no-op gives — so there is
 * no second switch to keep true to Cargo's.
 *
 * An event's payload began as another app's bytes, so it is held to `tableEventSchema` before any
 * listener hears it, and one that does not fit is dropped whole.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { z } from 'zod';
import { logger } from '$lib/diag/logger';
import {
	DELIVERY,
	SEATING,
	TABLE_EVENT,
	TABLE_ROLE,
	UNAVAILABLE,
	type Asked,
	type Delivery,
	type GmEvent,
	type GmSeat,
	type HeldSeat,
	type PlayerEvent,
	type PlayerSeat,
	type RememberedTable,
	type Returned,
	type Seating,
	type TableId,
	type TableLink,
	type UnavailableReason,
	type Unsubscribe,
} from './types';
import { tableViewOf } from './view';
import { tableEventSchema, tableViewSchema } from './wire-schema';

const TABLE_EVENT_CHANNEL = 'table-link-event';

/** An event as Rust sends it: one of a seat's, addressed to its table. */
export type TableLinkWireEvent = z.infer<typeof tableEventSchema>;

/** A payload as the event it is, or null when it is not one. */
function heldToShape(payload: unknown): TableLinkWireEvent | null {
	const parsed = tableEventSchema.safeParse(payload);
	if (parsed.success) return parsed.data;
	// the payload is a peer's and is not logged; that one was refused is worth knowing
	logger.warn('table link: an event that is not one was dropped');
	return null;
}

/** Every table event Rust pushes, whichever table it is for, once it has been held to its shape. */
export const listenToTableLink = (
	listener: (event: TableLinkWireEvent) => void,
): Promise<Unsubscribe> =>
	listen<unknown>(TABLE_EVENT_CHANNEL, (event) => {
		const held = heldToShape(event.payload);
		if (held) listener(held);
	});

/** An event as the seat it is for hears it, or null when it is the other seat's. */
const playerEvent = (event: TableLinkWireEvent): PlayerEvent | null =>
	event.kind === TABLE_EVENT.request ||
	event.kind === TABLE_EVENT.connection ||
	event.kind === TABLE_EVENT.record
		? event
		: null;
const gmEvent = (event: TableLinkWireEvent): GmEvent | null =>
	event.kind === TABLE_EVENT.request || event.kind === TABLE_EVENT.connection ? null : event;

/**
 * What Rust said about a seat before anybody could be listening for it. A seat's id is the
 * command's answer, and a player's connection starts changing state while that answer is still on
 * its way — so the events are kept from before the call and handed to the first listener.
 */
interface EarlyEvents {
	heard: TableLinkWireEvent[];
	stop: Unsubscribe;
}
const EARLY_EVENTS_MAX = 64;

async function hearEarly(): Promise<EarlyEvents> {
	const early: EarlyEvents = { heard: [], stop: () => {} };
	early.stop = await listenToTableLink((event) => {
		if (early.heard.length < EARLY_EVENTS_MAX) early.heard.push(event);
	});
	return early;
}

/** A seat's `subscribe`: its table's events of its own kind, the early ones first. */
const subscribing =
	<Event>(
		table: TableId,
		early: EarlyEvents,
		ownEvent: (event: TableLinkWireEvent) => Event | null,
	) =>
	async (listener: (event: Event) => void): Promise<Unsubscribe> => {
		const hear = (event: TableLinkWireEvent): void => {
			const own = event.table === table ? ownEvent(event) : null;
			if (own) listener(own);
		};
		const stop = await listenToTableLink(hear);
		early.stop();
		for (const event of early.heard.splice(0)) hear(event);
		return stop;
	};

/** A call that could not be made was not delivered — which is the whole of what a caller is told. */
const delivery = (command: string, args: Record<string, unknown>): Promise<Delivery> =>
	invoke<Delivery>(command, args).catch(() => DELIVERY.notDelivered);

const playerSeat = (table: TableId, code: string, early: EarlyEvents): PlayerSeat => ({
	table,
	code,
	leave: () => invoke('table_link_leave', { table }),
	publish: (character, sheet) => {
		// as JSON, which is how it travels: a key the engine left undefined is not a key
		const sent: unknown = JSON.parse(JSON.stringify(tableViewOf(character, sheet)));
		// held to the shape the GM's app will hold it to, so what cannot be shown is never sent
		const view = tableViewSchema.safeParse(sent);
		if (!view.success) {
			logger.warn('table link: this character has no view the table can show');
			return Promise.resolve(DELIVERY.notDelivered);
		}
		return delivery('table_link_publish', { table, view: view.data });
	},
	respond: (requestId, answer) => delivery('table_link_respond', { table, requestId, answer }),
	redial: () => invoke('table_link_redial', { table }),
	record: (body) => delivery('table_link_record', { table, body }),
	subscribe: subscribing(table, early, playerEvent),
});

const gmSeat = (table: TableId, invite: string | null, early: EarlyEvents): GmSeat => ({
	table,
	invite,
	leave: () => invoke('table_link_leave', { table }),
	request: async (participant, request): Promise<Asked> => {
		const requestId = crypto.randomUUID();
		const sent = await delivery('table_link_request', { table, participant, requestId, request });
		return sent === DELIVERY.delivered
			? { delivery: sent, requestId }
			: { delivery: DELIVERY.notDelivered };
	},
	dismiss: (participant) => invoke('table_link_dismiss', { table, participant }),
	setDoor: (open) => invoke<string | null>('table_link_door', { table, open }).catch(() => null),
	record: (body) => delivery('table_link_record', { table, body }),
	subscribe: subscribing(table, early, gmEvent),
});

/** What `table_link_host` and `table_link_join` answer. */
type RustSeating =
	| { status: typeof SEATING.seated; table: TableId; invite: string | null; code: string | null }
	| { status: typeof SEATING.unavailable; reason: UnavailableReason };

async function seat<S>(
	command: string,
	args: Record<string, unknown>,
	seatAt: (table: TableId, token: string, early: EarlyEvents) => S,
): Promise<Seating<S>> {
	const early = await hearEarly();
	// a refusal is a build without the feature, and reads as no table
	const seating = await invoke<RustSeating>(command, args).catch(() => null);
	if (seating?.status !== SEATING.seated) {
		early.stop();
		return seating ?? { status: SEATING.unavailable, reason: UNAVAILABLE.noTable };
	}
	return {
		status: SEATING.seated,
		seat: seatAt(seating.table, seating.invite ?? seating.code ?? '', early),
	};
}

/** What `table_link_resume` answers: the seat Rust still holds, and what its page was told. */
type RustHeld =
	| {
			role: typeof TABLE_ROLE.gm;
			table: TableId;
			name: string;
			invite: string | null;
			told: unknown[];
	  }
	| { role: typeof TABLE_ROLE.player; table: TableId; code: string; told: unknown[] };

async function resume(): Promise<HeldSeat> {
	const early = await hearEarly();
	// a refusal is a build without the feature, and reads as no seat
	const held = await invoke<RustHeld | null>('table_link_resume').catch(() => null);
	if (!held) {
		early.stop();
		return { role: TABLE_ROLE.none };
	}
	// what the page before this one was told comes first, then whatever was said since; a sheet in
	// it began as another app's bytes, so it is held to its shape like any event
	early.heard.unshift(...held.told.flatMap((payload) => heldToShape(payload) ?? []));
	return held.role === TABLE_ROLE.gm
		? { role: held.role, seat: gmSeat(held.table, held.invite, early), name: held.name }
		: { role: held.role, seat: playerSeat(held.table, held.code, early) };
}

/** Sit at a remembered table again: the seat is the role it was. */
async function returnTo(remembered: RememberedTable, locale: string): Promise<Returned> {
	const { table, role, name } = remembered;
	const args = { table, locale };
	if (role === TABLE_ROLE.gm) {
		const seating = await seat('table_link_return', args, gmSeat);
		return seating.status === SEATING.seated
			? { status: seating.status, held: { role, seat: seating.seat, name } }
			: seating;
	}
	const seating = await seat('table_link_return', args, playerSeat);
	return seating.status === SEATING.seated
		? { status: seating.status, held: { role, seat: seating.seat } }
		: seating;
}

export const tauriTableLink: TableLink = {
	// leaving a table that is not there does nothing in a build with the feature, and is refused
	// in a build without it
	available: () =>
		invoke('table_link_leave', { table: '' }).then(
			() => true,
			() => false,
		),
	host: ({ name, relay, locale }) => seat('table_link_host', { name, relay, locale }, gmSeat),
	join: ({ invite, name, locale }) => seat('table_link_join', { invite, name, locale }, playerSeat),
	resume,
	// a refusal is a build without the feature, which remembers nothing
	remembered: () => invoke<RememberedTable[]>('table_link_remembered').catch(() => []),
	returnTo,
	forget: (table) => invoke('table_link_forget', { table }),
};
