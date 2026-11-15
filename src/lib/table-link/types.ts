/*
 * The table link's seam: what a GM's app and a player's app say to each other, as an interface.
 * Beside `Storage` and for the same reason — everything above it talks to this, so the build with
 * no table (`noop.ts`: the web demo, and any desktop build without the Cargo feature) and the build
 * with one are the same app. `docs/internals/table-link.md` is the specification.
 *
 * The calls stand on a SEAT rather than on the service: `host` answers a GM's seat and `join` a
 * player's, so a player's seat has no way to ask and a GM's none to publish. The role is the type.
 */
import type { CharacterSheet } from '$lib/character/derive';
import type { Character } from '$lib/character/schema';
import type { DamagePart } from '$lib/play/hit-points';
import type { TableRoll, TableView } from './wire-schema';

export type TableId = string;
/** A participant's key AT ONE TABLE. Nothing links it to the same person at another. */
export type ParticipantId = string;
export type RequestId = string;

export interface Participant {
	id: ParticipantId;
	name: string;
}

/** Every call answers one of these. There is no queue: what was not delivered is not pending. */
export const DELIVERY = { delivered: 'delivered', notDelivered: 'not_delivered' } as const;
export type Delivery = (typeof DELIVERY)[keyof typeof DELIVERY];

/** Where a player's connection to the GM stands. */
export const CONNECTION = {
	connecting: 'connecting',
	/** The hello is said and the GM has not answered. */
	waiting: 'waiting',
	connected: 'connected',
	reconnecting: 'reconnecting',
	closed: 'closed',
} as const;
export type ConnectionState = (typeof CONNECTION)[keyof typeof CONNECTION];

/** Why a player's seat ended, or was never given. */
export const CLOSE_REASON = {
	unreachable: 'unreachable',
	invite: 'invite',
	declined: 'declined',
	version: 'version',
	full: 'full',
	dismissed: 'dismissed',
	tableClosed: 'table_closed',
	lost: 'lost',
	protocol: 'protocol',
} as const;
export type CloseReason = (typeof CLOSE_REASON)[keyof typeof CLOSE_REASON];

/** Why `host` or `join` gave no seat. */
export const UNAVAILABLE = {
	/** The build has no table link at all: the web demo, or a desktop build without the feature. */
	noTable: 'no_table',
	/** The person at this app said no to going online. */
	cancelled: 'cancelled',
	alreadySeated: 'already_seated',
	badName: 'bad_name',
	badInvite: 'bad_invite',
	badRelay: 'bad_relay',
	relayUnreachable: 'relay_unreachable',
	network: 'network',
} as const;
export type UnavailableReason = (typeof UNAVAILABLE)[keyof typeof UNAVAILABLE];

/** Which relay servers a table is reached through — the GM's choice, carried by the invitation. */
export const RELAY_MODE = { n0: 'n0', custom: 'custom', none: 'none' } as const;
export type RelayMode = (typeof RELAY_MODE)[keyof typeof RELAY_MODE];
export type RelaySetting =
	| { mode: typeof RELAY_MODE.n0 }
	| { mode: typeof RELAY_MODE.custom; url: string }
	| { mode: typeof RELAY_MODE.none };

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
export type RequestedRoll = (typeof REQUESTED_ROLL)[keyof typeof REQUESTED_ROLL];

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
	roll?: TableRoll;
}

export const TABLE_EVENT = {
	participantJoined: 'participant_joined',
	participantLeft: 'participant_left',
	view: 'view',
	request: 'request',
	answer: 'answer',
	connection: 'connection',
} as const;

export type PlayerEvent =
	| { kind: typeof TABLE_EVENT.request; requestId: RequestId; request: TableRequest }
	| { kind: typeof TABLE_EVENT.connection; state: ConnectionState; reason?: CloseReason };

export type GmEvent =
	| { kind: typeof TABLE_EVENT.participantJoined; participant: Participant }
	| { kind: typeof TABLE_EVENT.participantLeft; participant: ParticipantId }
	/** A player's sheet as the table sees it, already held to `tableViewSchema`. */
	| { kind: typeof TABLE_EVENT.view; participant: ParticipantId; view: TableView }
	| {
			kind: typeof TABLE_EVENT.answer;
			participant: ParticipantId;
			requestId: RequestId;
			answer: TableAnswer;
	  };

export type Unsubscribe = () => void;

interface Seat<Event> {
	readonly table: TableId;
	/** A GM's leaving closes the table for everyone at it. */
	leave(): Promise<void>;
	subscribe(listener: (event: Event) => void): Promise<Unsubscribe>;
}

export interface PlayerSeat extends Seat<PlayerEvent> {
	/** The digits to read to the GM, who is shown the same ones before letting this seat in. */
	readonly code: string;
	/** Says what is true NOW. What leaves is the table's view of the character (`view.ts`), and
	 *  what crosses the wire — the keys of it that changed — is the transport's to decide. */
	publish(character: Character, sheet: CharacterSheet): Promise<Delivery>;
	respond(request: RequestId, answer: TableAnswer): Promise<Delivery>;
}

/** What asking came to: the id an answer will carry, when the request left. */
export type Asked =
	| { delivery: typeof DELIVERY.delivered; requestId: RequestId }
	| { delivery: typeof DELIVERY.notDelivered };

export interface GmSeat extends Seat<GmEvent> {
	/** What to hand a player. It names the table and knocks; the GM still lets each one in. Null
	 *  at a seat picked up again while its door was shut. */
	readonly invite: string | null;
	request(participant: ParticipantId, request: TableRequest): Promise<Asked>;
	/** Take a participant's seat away, and their way back in. */
	dismiss(participant: ParticipantId): Promise<void>;
	/** Open the door under a NEW invitation, which is answered, or shut it (null). Either way every
	 *  invitation handed out before stops working; whoever is seated stays. */
	setDoor(open: boolean): Promise<string | null>;
}

export const SEATING = { seated: 'seated', unavailable: 'unavailable' } as const;
export type Seating<S> =
	| { status: typeof SEATING.seated; seat: S }
	| { status: typeof SEATING.unavailable; reason: UnavailableReason };

export const TABLE_ROLE = { none: 'none', gm: 'gm', player: 'player' } as const;
export type TableRole = (typeof TABLE_ROLE)[keyof typeof TABLE_ROLE];

/** The seat the app was already holding when a page asked: a reload ends a page, not a table. */
export type HeldSeat =
	| { role: typeof TABLE_ROLE.none }
	| { role: typeof TABLE_ROLE.gm; seat: GmSeat; name: string }
	| { role: typeof TABLE_ROLE.player; seat: PlayerSeat };

export interface HostOptions {
	/** The table's name, as players are shown it. */
	name: string;
	relay: RelaySetting;
	/** The language the native question is asked in. */
	locale: string;
}

export interface JoinOptions {
	invite: string;
	/** The name the GM is asked about. */
	name: string;
	locale: string;
}

export interface TableLink {
	/** Does this build have a table at all? Asked without opening anything or asking anybody, so
	 *  the app can leave the table out of its navigation where there is none to sit at. */
	available(): Promise<boolean>;
	/** Opening a table is confirmed outside this interface, in a dialog the webview cannot press. */
	host(options: HostOptions): Promise<Seating<GmSeat>>;
	/** So is joining one — and so is the GM's letting this seat in. */
	join(options: JoinOptions): Promise<Seating<PlayerSeat>>;
	/** Pick up the seat the app still holds. It asks nobody and opens nothing: the person said yes
	 *  when the seat was taken. Its first listener hears the table as it stands — who is at it and
	 *  the sheets they showed, the connection, the requests nobody answered. */
	resume(): Promise<HeldSeat>;
}
