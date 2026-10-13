/*
 * The table link's seam: what a GM's app and a player's app say to each other, as an interface
 * with no transport behind it. Beside `Storage` and for the same reason — everything above it
 * talks to this, so the build with no table (`noop.ts`: the web demo, and any desktop build without
 * the Cargo feature) and the build with one are the same app.
 *
 * The calls stand on a SEAT rather than on the service: `host` answers a GM's seat and `join` a
 * player's, so a player's seat has no way to ask and a GM's none to publish. The role is the type.
 */
import type { CharacterSheet } from '$lib/character/derive';
import type { Character } from '$lib/character/schema';
import type { RollLogEntry } from '$lib/combat/roll';
import type { DamagePart } from '$lib/play/hit-points';

export type TableId = string;
/** A participant's key AT ONE TABLE. Nothing links it to the same person at another. */
type ParticipantId = string;
type RequestId = string;

interface Participant {
	id: ParticipantId;
	name: string;
}

/** Every call answers one of these. There is no queue: what was not delivered is not pending. */
export const DELIVERY = { delivered: 'delivered', notDelivered: 'not_delivered' } as const;
export type Delivery = (typeof DELIVERY)[keyof typeof DELIVERY];

export const CONNECTION = { unavailable: 'unavailable' } as const;
type ConnectionState = (typeof CONNECTION)[keyof typeof CONNECTION];

export const TABLE_REQUEST = {
	damage: 'damage',
	heal: 'heal',
	effect: 'effect',
	roll: 'roll',
} as const;

export const REQUESTED_ROLL = {
	abilityCheck: 'ability_check',
	savingThrow: 'saving_throw',
	skill: 'skill',
} as const;
type RequestedRoll = (typeof REQUESTED_ROLL)[keyof typeof REQUESTED_ROLL];

/**
 * What a GM may ask of a player. Catalog ids and numbers, never an effect token or a dice formula.
 * A request never applies itself: it arrives, the player sees it and answers.
 */
export type TableRequest =
	/** The raw hit. The player's app applies its own defenses, since only it knows its sheet. */
	| ({ kind: typeof TABLE_REQUEST.damage } & DamagePart)
	| { kind: typeof TABLE_REQUEST.heal; amount: number }
	/** A state or effect by its catalog id; its duration is set on the player's side. */
	| { kind: typeof TABLE_REQUEST.effect; id: string }
	/** `id` is the ability or skill, as the roller names it. `dc` is there when the GM announced it. */
	| { kind: typeof TABLE_REQUEST.roll; roll: RequestedRoll; id: string; dc?: number };

export const TABLE_ANSWER = { accepted: 'accepted', declined: 'declined' } as const;

export interface TableAnswer {
	outcome: (typeof TABLE_ANSWER)[keyof typeof TABLE_ANSWER];
	/** The roll that was made. A roll is an event and not a state of the sheet, so it travels here;
	 *  what damage or healing left is seen in the next publish. */
	roll?: RollLogEntry;
}

export const TABLE_EVENT = {
	participantJoined: 'participant_joined',
	participantLeft: 'participant_left',
	view: 'view',
	request: 'request',
	answer: 'answer',
	connection: 'connection',
} as const;

interface ConnectionChanged {
	kind: typeof TABLE_EVENT.connection;
	state: ConnectionState;
}

export type PlayerEvent =
	| { kind: typeof TABLE_EVENT.request; requestId: RequestId; request: TableRequest }
	| ConnectionChanged;

export type GmEvent =
	| { kind: typeof TABLE_EVENT.participantJoined; participant: Participant }
	| { kind: typeof TABLE_EVENT.participantLeft; participant: ParticipantId }
	| {
			kind: typeof TABLE_EVENT.view;
			participant: ParticipantId;
			character: Character;
			view: CharacterSheet;
	  }
	| {
			kind: typeof TABLE_EVENT.answer;
			participant: ParticipantId;
			requestId: RequestId;
			answer: TableAnswer;
	  }
	| ConnectionChanged;

export type Unsubscribe = () => void;

interface Seat<Event> {
	readonly table: TableId;
	leave(): Promise<void>;
	subscribe(listener: (event: Event) => void): Promise<Unsubscribe>;
}

export interface PlayerSeat extends Seat<PlayerEvent> {
	/** Says what is true NOW: the character as it is saved and the sheet derived from it, traces
	 *  included. What crosses the wire — the keys that changed — is the transport's to decide. */
	publish(character: Character, view: CharacterSheet): Promise<Delivery>;
	respond(request: RequestId, answer: TableAnswer): Promise<Delivery>;
}

export interface GmSeat extends Seat<GmEvent> {
	request(participant: ParticipantId, request: TableRequest): Promise<Delivery>;
}

export const SEATING = { seated: 'seated', unavailable: 'unavailable' } as const;
export type Seating<S> =
	{ status: typeof SEATING.seated; seat: S } | { status: typeof SEATING.unavailable };

export interface TableLink {
	host(name: string): Promise<Seating<GmSeat>>;
	/** Joining is approved outside this interface, in a dialog the webview cannot press. */
	join(invite: string): Promise<Seating<PlayerSeat>>;
}
