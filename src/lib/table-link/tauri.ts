/*
 * The desktop side of `TableLink`: the commands of `src-tauri/src/table_link.rs` and the channel
 * Rust pushes table events down. One of the few files allowed to import Tauri (eslint.config.js).
 *
 * Whether the build carries the feature is learned by CALLING. A build without it has no such
 * command, the call is refused, and that refusal is the same answer the no-op gives — so there is
 * no second switch to keep true to Cargo's.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
	DELIVERY,
	SEATING,
	TABLE_EVENT,
	type Delivery,
	type GmEvent,
	type GmSeat,
	type PlayerEvent,
	type PlayerSeat,
	type Seating,
	type TableId,
	type TableLink,
	type Unsubscribe,
} from './types';

const TABLE_EVENT_CHANNEL = 'table-link-event';

/** An event as Rust sends it: one of a seat's, addressed to its table. */
export type TableLinkWireEvent = (GmEvent | PlayerEvent) & { table: TableId | null };

/** Every table event Rust pushes, whichever table it is for.
 *  shortcut: a payload is trusted as typed because only this app's own Rust sends one; validate it
 *  against a schema here when a transport makes it somebody else's bytes. */
export const listenToTableLink = (
	listener: (event: TableLinkWireEvent) => void,
): Promise<Unsubscribe> =>
	listen<TableLinkWireEvent>(TABLE_EVENT_CHANNEL, (event) => {
		listener(event.payload);
	});

const isPlayerEvent = (event: GmEvent | PlayerEvent): event is PlayerEvent =>
	event.kind === TABLE_EVENT.request || event.kind === TABLE_EVENT.connection;
const isGmEvent = (event: GmEvent | PlayerEvent): event is GmEvent =>
	event.kind !== TABLE_EVENT.request;

/** A call that could not be made was not delivered — which is the whole of what a caller is told. */
const delivery = (command: string, args: Record<string, unknown>): Promise<Delivery> =>
	invoke<Delivery>(command, args).catch(() => DELIVERY.notDelivered);

const playerSeat = (table: TableId): PlayerSeat => ({
	table,
	leave: () => invoke('table_link_leave', { table }),
	publish: (character, view) => delivery('table_link_publish', { table, character, view }),
	respond: (requestId, answer) => delivery('table_link_respond', { table, requestId, answer }),
	subscribe: (listener) =>
		listenToTableLink((event) => {
			if (event.table === table && isPlayerEvent(event)) listener(event);
		}),
});

const gmSeat = (table: TableId): GmSeat => ({
	table,
	leave: () => invoke('table_link_leave', { table }),
	request: (participant, request) =>
		delivery('table_link_request', { table, participant, request }),
	subscribe: (listener) =>
		listenToTableLink((event) => {
			if (event.table === table && isGmEvent(event)) listener(event);
		}),
});

async function seat<S>(
	command: string,
	args: Record<string, unknown>,
	seatAt: (table: TableId) => S,
): Promise<Seating<S>> {
	// a refusal is a build without the feature, and reads as no table
	const table = await invoke<TableId | null>(command, args).catch(() => null);
	return table === null
		? { status: SEATING.unavailable }
		: { status: SEATING.seated, seat: seatAt(table) };
}

export const tauriTableLink: TableLink = {
	host: (name) => seat('table_link_host', { name }, gmSeat),
	join: (invite) => seat('table_link_join', { invite }, playerSeat),
};
