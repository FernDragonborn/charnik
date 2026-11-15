/*
 * The Table view-model: the seat this app holds at a table — a GM's or a player's — and what each
 * does with it. One shared instance (`table`), read by the Table screen and by the request prompt
 * the layout mounts over every screen.
 *
 * A GM's side keeps who is seated, the sheet each one shows, and what was asked of them. A
 * player's side keeps the connection's state and the requests waiting for an answer.
 *
 * **A request never applies itself.** It waits in `requests` until the player presses, and it is
 * then carried out by the SAME actions a click on the sheet uses (`combat.act`, `combat.roll`,
 * the effects picker's switch) — so what a GM's damage does to a sheet is what the player's own
 * Damage press does, defenses, concentration and death included (`docs/internals/table-link.md`).
 */
import { toast } from '$lib/toast/toast';
import { t } from '$lib/i18n';
import { app } from '$lib/stores/app.svelte';
import { saveCharacterGuarded } from '$lib/character/store.svelte';
import type { CharacterSheet } from '$lib/character/derive';
import { naturalOf } from '$lib/rules/dice';
import { AUTO_OUTCOME } from '$lib/combat/roll';
import { heal, takeDamage } from '$lib/play/hit-points';
import {
	abilityCheckRoll,
	abilityOf,
	savingThrowRoll,
	skillOf,
	skillRoll,
	type SheetRollSpec,
} from '$lib/combat/sheet-roll-specs';
import { getTableLink } from '$lib/table-link/provider';
import {
	CLOSE_REASON,
	CONNECTION,
	DELIVERY,
	REQUESTED_ROLL,
	SEATING,
	TABLE_ANSWER,
	TABLE_EVENT,
	TABLE_REQUEST,
	TABLE_ROLE,
	type CloseReason,
	type ConnectionState,
	type GmEvent,
	type GmSeat,
	type ParticipantId,
	type PlayerEvent,
	type PlayerSeat,
	type RequestId,
	type TableLink,
	type TableRequest,
	type TableRole,
	type UnavailableReason,
	type Unsubscribe,
} from '$lib/table-link/types';
import { tableViewOf } from '$lib/table-link/view';
import type { TableRoll, TableView } from '$lib/table-link/wire-schema';
import type { StateChoice } from '../combat/effects-editor.svelte';
import { combat } from '../combat/combat-view-model.svelte';

export { TABLE_ROLE, type TableRole };

/** There is nobody to sit down as: joining publishes the open character, and none is open. */
export const NO_CHARACTER = 'no_character';
export type TableProblem = UnavailableReason | CloseReason | typeof NO_CHARACTER;

export const ASK_STATUS = {
	pending: 'pending',
	accepted: 'accepted',
	declined: 'declined',
} as const;
export type AskStatus = (typeof ASK_STATUS)[keyof typeof ASK_STATUS];

/** Somebody the GM let in, and the sheet they show. */
export interface SeatedPlayer {
	id: ParticipantId;
	name: string;
	/** Absent until their app has said what their sheet says. */
	view: TableView | null;
	/** False while their connection is down; their app dials again by itself. */
	present: boolean;
}

/** Something the GM asked, and what came back. */
export interface AskedRow {
	requestId: RequestId;
	participant: ParticipantId;
	name: string;
	request: TableRequest;
	/** The DC the roll is held to on the GM's side, announced to the player or not. */
	dc?: number;
	status: AskStatus;
	roll?: TableRoll;
}

/** Something the GM asked of this player, waiting for a press. */
export interface PendingRequest {
	requestId: RequestId;
	request: TableRequest;
}

/** How long the open character is left to settle before the table is told what it says now. */
const PUBLISH_DEBOUNCE_MS = 150;
/** How many of the GM's asks are kept on screen. */
const ASKED_MAX = 50;
/** How many requests may wait for the player at once; one past that is declined unseen, so a GM's
 *  app cannot fill the player's screen or memory. */
const PENDING_MAX = 12;

/** Did a roll meet its DC? A condition that forced the outcome decides it over the number. */
export const rollPassed = (roll: TableRoll, dc: number): boolean =>
	roll.outcome ? roll.outcome === AUTO_OUTCOME.succeed : roll.total >= dc;

/** The roll a request asks for, on this sheet — or null when it names nothing the sheet rolls. */
export function requestedRollSpec(
	request: Extract<TableRequest, { kind: typeof TABLE_REQUEST.roll }>,
	sheet: CharacterSheet,
): SheetRollSpec | null {
	if (request.roll === REQUESTED_ROLL.skill) {
		const skill = skillOf(request.id);
		return skill ? skillRoll(skill, sheet) : null;
	}
	const ability = abilityOf(request.id);
	if (!ability) return null;
	return request.roll === REQUESTED_ROLL.savingThrow
		? savingThrowRoll(ability, sheet)
		: abilityCheckRoll(ability, sheet);
}

export class TableVM {
	constructor(private link: () => TableLink = getTableLink) {}

	/** Does this build have a table? Null until asked (`checkAvailable`). */
	available = $state<boolean | null>(null);
	/** A seat is being asked for: the native question is on screen, or the endpoint is binding. */
	busy = $state(false);
	/** Why the last seat was not given, or ended. Said until the next attempt. */
	problem = $state<TableProblem | null>(null);
	role = $state<TableRole>(TABLE_ROLE.none);

	// --- a GM's seat ------------------------------------------------------------------------------
	tableName = $state('');
	/** What to hand a player, or null while the door is shut. */
	invite = $state<string | null>(null);
	players = $state<SeatedPlayer[]>([]);
	/** Newest first. */
	asked = $state<AskedRow[]>([]);

	// --- a player's seat --------------------------------------------------------------------------
	/** The digits to read to the GM. */
	code = $state('');
	connection = $state<ConnectionState>(CONNECTION.connecting);
	/** Oldest first: the prompt shows the first. */
	requests = $state<PendingRequest[]>([]);

	private gmSeat: GmSeat | null = null;
	private playerSeat: PlayerSeat | null = null;
	private stopListening: Unsubscribe | null = null;

	checkAvailable = async (): Promise<boolean> => {
		if (this.available === null) {
			const has = await this.link().available();
			// asked from two places at once, the first answer stands
			this.available ??= has;
		}
		return this.available;
	};

	/** Open a table as its GM. The person is asked natively before anything goes online. */
	host = async (name: string): Promise<void> => {
		if (this.busy || this.role !== TABLE_ROLE.none) return;
		this.busy = true;
		this.problem = null;
		try {
			const seating = await this.link().host({
				name,
				relay: app.tableRelay,
				locale: app.activeLocale,
			});
			if (seating.status !== SEATING.seated) {
				this.problem = seating.reason;
				return;
			}
			await this.sitAsGm(seating.seat, name.trim());
		} finally {
			this.busy = false;
		}
	};

	private async sitAsGm(seat: GmSeat, name: string): Promise<void> {
		this.gmSeat = seat;
		this.tableName = name;
		this.invite = seat.invite;
		this.players = [];
		this.asked = [];
		this.role = TABLE_ROLE.gm;
		this.stopListening = await seat.subscribe(this.onGmEvent);
	}

	private async sitAsPlayer(seat: PlayerSeat): Promise<void> {
		this.playerSeat = seat;
		this.code = seat.code;
		this.connection = CONNECTION.connecting;
		this.requests = [];
		this.role = TABLE_ROLE.player;
		this.stopListening = await seat.subscribe(this.onPlayerEvent);
	}

	/**
	 * Pick up the seat the app still holds. A page that loads again has forgotten its table, and
	 * the table has not ended: the players are still at it. What comes back is who is seated and
	 * their sheets, or the player's connection and the requests they had not answered; the GM's log
	 * of asks was this page's own and starts empty.
	 */
	resume = async (): Promise<void> => {
		if (this.busy || this.role !== TABLE_ROLE.none) return;
		this.busy = true;
		try {
			const held = await this.link().resume();
			if (held.role === TABLE_ROLE.gm) await this.sitAsGm(held.seat, held.name);
			if (held.role === TABLE_ROLE.player) {
				// the sheet the table is told again is the open character's
				if (!combat.character) await combat.load();
				await this.sitAsPlayer(held.seat);
			}
		} finally {
			this.busy = false;
		}
	};

	/** Sit at a table as the open character. */
	join = async (invite: string): Promise<void> => {
		if (this.busy || this.role !== TABLE_ROLE.none) return;
		this.busy = true;
		this.problem = null;
		try {
			if (!combat.character) await combat.load();
			const character = combat.character;
			if (!character) {
				this.problem = NO_CHARACTER;
				return;
			}
			const seating = await this.link().join({
				invite,
				name: character.build.name,
				locale: app.activeLocale,
			});
			if (seating.status !== SEATING.seated) {
				this.problem = seating.reason;
				return;
			}
			await this.sitAsPlayer(seating.seat);
		} finally {
			this.busy = false;
		}
	};

	/** Give the seat up. A GM's leaving closes the table for everyone at it. */
	leave = (): Promise<void> => this.endSeat(null);

	private async endSeat(problem: TableProblem | null): Promise<void> {
		const seat = this.gmSeat ?? this.playerSeat;
		this.stopListening?.();
		this.stopListening = null;
		this.gmSeat = null;
		this.playerSeat = null;
		this.role = TABLE_ROLE.none;
		this.players = [];
		this.asked = [];
		this.requests = [];
		this.invite = null;
		this.problem = problem;
		// best-effort: the seat is already given up here, and Rust drops its half with the app
		await seat?.leave().catch(() => {});
	}

	// --- the GM's side ----------------------------------------------------------------------------

	private onGmEvent = (event: GmEvent): void => {
		switch (event.kind) {
			case TABLE_EVENT.participantJoined: {
				const { id, name } = event.participant;
				const seated = this.players.find((player) => player.id === id);
				if (seated) Object.assign(seated, { name, present: true });
				else this.players = [...this.players, { id, name, view: null, present: true }];
				break;
			}
			case TABLE_EVENT.participantLeft: {
				const seated = this.players.find((player) => player.id === event.participant);
				if (seated) seated.present = false;
				break;
			}
			case TABLE_EVENT.view: {
				const seated = this.players.find((player) => player.id === event.participant);
				if (seated) seated.view = event.view;
				break;
			}
			case TABLE_EVENT.answer: {
				// only the participant who was asked may answer it, and only once
				const row = this.asked.find(
					(asked) =>
						asked.requestId === event.requestId &&
						asked.participant === event.participant &&
						asked.status === ASK_STATUS.pending,
				);
				if (!row) break;
				row.status =
					event.answer.outcome === TABLE_ANSWER.accepted
						? ASK_STATUS.accepted
						: ASK_STATUS.declined;
				if (event.answer.roll) row.roll = event.answer.roll;
				break;
			}
		}
	};

	/**
	 * Ask the same thing of several players. `heldTo` is the DC a roll is judged against on the GM's
	 * side whether or not the request announces it — the request carries a DC only when the GM chose
	 * to say it.
	 */
	ask = async (
		participants: readonly ParticipantId[],
		request: TableRequest,
		heldTo?: number,
	): Promise<void> => {
		const seat = this.gmSeat;
		if (!seat) return;
		const unheard: string[] = [];
		for (const participant of participants) {
			const name = this.players.find((player) => player.id === participant)?.name ?? participant;
			const sent = await seat.request(participant, request);
			if (sent.delivery !== DELIVERY.delivered) {
				unheard.push(name);
				continue;
			}
			const row: AskedRow = {
				requestId: sent.requestId,
				participant,
				name,
				request,
				...(heldTo === undefined ? {} : { dc: heldTo }),
				status: ASK_STATUS.pending,
			};
			this.asked = [row, ...this.asked].slice(0, ASKED_MAX);
		}
		if (unheard.length)
			toast.warning(t('table.notice.notDelivered', { names: unheard.join(', ') }));
	};

	/** Take a player's seat away, and their way back in. */
	dismiss = async (participant: ParticipantId): Promise<void> => {
		await this.gmSeat?.dismiss(participant);
		this.players = this.players.filter((player) => player.id !== participant);
	};

	/** Open the door under a new invitation, or shut it. */
	setDoor = async (open: boolean): Promise<void> => {
		if (this.gmSeat) this.invite = await this.gmSeat.setDoor(open);
	};

	// --- the player's side ------------------------------------------------------------------------

	private onPlayerEvent = (event: PlayerEvent): void => {
		if (event.kind === TABLE_EVENT.request) {
			this.queue({ requestId: event.requestId, request: event.request });
			return;
		}
		this.connection = event.state;
		if (event.state === CONNECTION.connected) void this.publish();
		if (event.state === CONNECTION.closed) void this.endSeat(event.reason ?? CLOSE_REASON.lost);
	};

	private queue(pending: PendingRequest): void {
		if (this.requests.some((waiting) => waiting.requestId === pending.requestId)) return;
		if (this.requests.length >= PENDING_MAX) {
			void this.playerSeat?.respond(pending.requestId, { outcome: TABLE_ANSWER.declined });
			return;
		}
		this.requests = [...this.requests, pending];
	}

	/** Dial the table now instead of waiting for the next try the seat makes by itself. */
	redial = async (): Promise<void> => {
		await this.playerSeat?.redial();
	};

	/** Tell the table what the open character says now. */
	publish = async (): Promise<void> => {
		const { character, sheet } = combat;
		if (this.playerSeat && character && sheet) await this.playerSeat.publish(character, sheet);
	};

	/**
	 * Keep the table told for as long as this app is seated: whenever what the table sees of the
	 * open character changes, say so. Started once by the layout; answers the way to stop.
	 */
	keepPublishing = (): (() => void) => {
		let settling: ReturnType<typeof setTimeout> | undefined;
		const stop = $effect.root(() => {
			$effect(() => {
				if (this.role !== TABLE_ROLE.player || this.connection !== CONNECTION.connected) return;
				const { character, sheet } = combat;
				if (!character || !sheet) return;
				// read what the table sees, so a change to any of it runs this again
				tableViewOf(character, sheet);
				clearTimeout(settling);
				settling = setTimeout(() => void this.publish(), PUBLISH_DEBOUNCE_MS);
			});
		});
		return () => {
			clearTimeout(settling);
			stop();
		};
	};

	/** The state a request names, as this character's own picker lists it. */
	stateFor = (id: string): StateChoice | undefined =>
		combat.effects.stateCatalog.find((choice) => choice.rowId === id);

	/** Can this request be carried out on the open sheet? One naming a skill or a state this app
	 *  does not have can only be declined. */
	canAccept = (request: TableRequest): boolean => {
		if (request.kind === TABLE_REQUEST.roll)
			return !!combat.sheet && !!requestedRollSpec(request, combat.sheet);
		if (request.kind === TABLE_REQUEST.effect) return !!this.stateFor(request.id);
		return !!combat.sheet;
	};

	/** Do what was asked, through the sheet's own actions, and answer. */
	accept = async (pending: PendingRequest): Promise<void> => {
		if (!this.requests.includes(pending) || !this.canAccept(pending.request)) return;
		this.requests = this.requests.filter((waiting) => waiting !== pending);
		const roll = this.carryOut(pending.request);
		// the play screen's autosave is not running on every screen a request can arrive over
		if (combat.character) void saveCharacterGuarded(combat.character);
		await this.answer(pending.requestId, {
			outcome: TABLE_ANSWER.accepted,
			...(roll ? { roll } : {}),
		});
	};

	decline = async (pending: PendingRequest): Promise<void> => {
		if (!this.requests.includes(pending)) return;
		this.requests = this.requests.filter((waiting) => waiting !== pending);
		await this.answer(pending.requestId, { outcome: TABLE_ANSWER.declined });
	};

	private async answer(
		requestId: RequestId,
		answer: Parameters<PlayerSeat['respond']>[1],
	): Promise<void> {
		const delivery = await this.playerSeat?.respond(requestId, answer);
		if (delivery !== DELIVERY.delivered) toast.warning(t('table.notice.answerLost'));
	}

	/** Carry a request out on the open character; the roll it made, when it made one. */
	private carryOut(request: TableRequest): TableRoll | undefined {
		switch (request.kind) {
			case TABLE_REQUEST.damage: {
				const hit = { amount: request.amount, type: request.type };
				combat.act((character, ctx) => takeDamage(character, hit, ctx));
				return undefined;
			}
			case TABLE_REQUEST.heal:
				combat.act((character, ctx) => heal(character, { amount: request.amount }, ctx));
				return undefined;
			case TABLE_REQUEST.effect: {
				const state = this.stateFor(request.id);
				if (!state) return undefined;
				// a state already on the character is not put on a second time
				const { owned, foreign } = combat.effects.presenceOf(state);
				if (!owned.length && !foreign.length) combat.effects.toggleState(state);
				return undefined;
			}
			case TABLE_REQUEST.roll:
				return this.rollFor(request);
		}
	}

	/** Make the roll a request asks for, the way a tap on the sheet makes it, and read it back. */
	private rollFor(
		request: Extract<TableRequest, { kind: typeof TABLE_REQUEST.roll }>,
	): TableRoll | undefined {
		const spec = combat.sheet ? requestedRollSpec(request, combat.sheet) : null;
		if (!spec) return undefined;
		const before = combat.journal.log[0];
		// a plain event rolls at once: the dice tray hands no result back to answer the GM with
		combat.roll(spec.name, spec.mod, new Event('table-request'), spec.target);
		const entry = combat.journal.log[0];
		if (!entry || entry === before) return undefined;
		const natural = naturalOf(entry);
		const roll: TableRoll = {
			total: Number.isFinite(entry.total) ? entry.total : 0,
			...(natural === undefined ? {} : { natural }),
			advantage: entry.advantage,
			mod: entry.mod,
			...(entry.outcome ? { outcome: entry.outcome } : {}),
		};
		if (request.dc !== undefined)
			combat.notify({
				text: {
					key: rollPassed(roll, request.dc) ? 'table.notice.passed' : 'table.notice.failed',
					values: { dc: request.dc },
				},
			});
		return roll;
	}
}

export const table = new TableVM();
