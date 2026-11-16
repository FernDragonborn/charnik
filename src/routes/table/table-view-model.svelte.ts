/*
 * The Table view-model: the seat this app holds at a table — a GM's or a player's — and what each
 * does with it. One shared instance (`table`), read by the Table screen and by the request prompt
 * the layout mounts over every screen.
 *
 * A GM's side keeps who is seated, the sheet each one shows, and what was asked of them. A
 * player's side keeps the connection's state, and `asks` (`PlayerRequests`) the requests waiting
 * for an answer — **a request never applies itself**.
 */
import { toast } from '$lib/toast/toast';
import { t } from '$lib/i18n';
import { app } from '$lib/stores/app.svelte';
import { getTableLink } from '$lib/table-link/provider';
import {
	CLOSE_REASON,
	CONNECTION,
	DELIVERY,
	SEATING,
	TABLE_ANSWER,
	TABLE_EVENT,
	TABLE_ROLE,
	UNAVAILABLE,
	type CloseReason,
	type ConnectionState,
	type Audience,
	type GmEvent,
	type GmSeat,
	type ParticipantId,
	type PlayerEvent,
	type PlayerSeat,
	type RememberedTable,
	type TableLink,
	type TableRequest,
	type TableRole,
	type UnavailableReason,
	type Unsubscribe,
} from '$lib/table-link/types';
import { tableViewOf } from '$lib/table-link/view';
import type { TableView } from '$lib/table-link/wire-schema';
import { combat } from '../combat/combat-view-model.svelte';
import { PlayerRequests } from './player-requests.svelte';
import { TableLog } from './table-log.svelte';
import {
	ASKED_MAX,
	ASK_STATUS,
	dropAskedLog,
	keepAskedLog,
	readAskedLog,
	type AskStatus,
	type AskedRow,
} from './asked-log';

export { TABLE_ROLE, type TableRole };

/** There is nobody to sit down as: joining publishes the open character, and none is open. */
export const NO_CHARACTER = 'no_character';
export type TableProblem = UnavailableReason | CloseReason | typeof NO_CHARACTER;

export { ASK_STATUS, type AskStatus, type AskedRow };

/** Somebody the GM let in, and the sheet they show. */
export interface SeatedPlayer {
	id: ParticipantId;
	name: string;
	/** Absent until their app has said what their sheet says. */
	view: TableView | null;
	/** False while their connection is down; their app dials again by itself. */
	present: boolean;
}

/** How long the open character is left to settle before the table is told what it says now. */
const PUBLISH_DEBOUNCE_MS = 150;
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
	/** What the GM asked of this player, waiting for a press. */
	asks = new PlayerRequests(
		(requestId, answer) =>
			this.playerSeat?.respond(requestId, answer) ?? Promise.resolve(undefined),
	);

	/** The table's log, as this app holds it — the GM's and a player's alike. */
	log = new TableLog(() => ({
		role: this.role,
		write: (body) => (this.gmSeat ?? this.playerSeat)?.record(body),
	}));

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
		// a table just opened has no log; one picked up again has the log its last page kept, and
		// the answers that page missed are among what its first listener hears
		this.asked = readAskedLog(seat.table);
		this.log.clear();
		this.role = TABLE_ROLE.gm;
		this.stopListening = await seat.subscribe(this.onGmEvent);
	}

	private async sitAsPlayer(seat: PlayerSeat): Promise<void> {
		this.playerSeat = seat;
		this.code = seat.code;
		this.connection = CONNECTION.connecting;
		this.asks.clear();
		this.log.clear();
		this.role = TABLE_ROLE.player;
		this.stopListening = await seat.subscribe(this.onPlayerEvent);
	}

	/**
	 * Pick up the seat the app still holds. A page that loads again has forgotten its table, and
	 * the table has not ended: the players are still at it. What comes back is who is seated and
	 * their sheets with the log of asks the last page kept, or the player's connection and the
	 * requests they had not answered.
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

	// --- tables this app sat at --------------------------------------------------------------------

	/** The tables this app can return to: sat at, and not left. */
	remembered = $state<RememberedTable[]>([]);

	loadRemembered = async (): Promise<void> => {
		this.remembered = await this.link().remembered();
	};

	/** Sit at a remembered table again. The person is asked natively before anything goes online. */
	returnTo = async (remembered: RememberedTable): Promise<void> => {
		if (this.busy || this.role !== TABLE_ROLE.none) return;
		this.busy = true;
		this.problem = null;
		try {
			const returned = await this.link().returnTo(remembered, app.activeLocale);
			if (returned.status !== SEATING.seated) {
				this.problem = returned.reason;
				if (returned.reason === UNAVAILABLE.forgotten) await this.loadRemembered();
				return;
			}
			const { held } = returned;
			if (held.role === TABLE_ROLE.gm) await this.sitAsGm(held.seat, held.name);
			else {
				if (!combat.character) await combat.load();
				await this.sitAsPlayer(held.seat);
			}
		} finally {
			this.busy = false;
		}
	};

	forget = async (remembered: RememberedTable): Promise<void> => {
		await this.link().forget(remembered.table);
		await this.loadRemembered();
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
		this.asks.clear();
		this.log.clear();
		this.invite = null;
		this.problem = problem;
		dropAskedLog();
		// best-effort: the seat is already given up here, and Rust drops its half with the app
		await seat?.leave().catch(() => {});
		// a table left is a table forgotten
		await this.loadRemembered();
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
			case TABLE_EVENT.record:
				this.log.take(event);
				break;
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
				this.keepAsked();
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
			this.keepAsked();
		}
		if (unheard.length)
			toast.warning(t('table.notice.notDelivered', { names: unheard.join(', ') }));
	};

	/** Keep the log for the page that loads next (`asked-log.ts`). */
	private keepAsked(): void {
		if (this.gmSeat) keepAskedLog(this.gmSeat.table, $state.snapshot(this.asked));
	}

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
			this.asks.queue({ requestId: event.requestId, request: event.request });
			return;
		}
		if (event.kind === TABLE_EVENT.record) {
			this.log.take(event);
			return;
		}
		this.connection = event.state;
		if (event.state === CONNECTION.connected) void this.publish();
		if (event.state === CONNECTION.closed) void this.endSeat(event.reason ?? CLOSE_REASON.lost);
	};

	/** Dial the table now instead of waiting for the next try the seat makes by itself. */
	redial = async (): Promise<void> => {
		await this.playerSeat?.redial();
	};

	/** Tell the table what the open character says now. */
	publish = async (): Promise<void> => {
		const { character, sheet } = combat;
		if (this.playerSeat && character && sheet) await this.playerSeat.publish(character, sheet);
	};

	/** Who this app's rolls go to: each seat has its own setting, since a GM's rolls are kept and
	 *  a player's shown unless the person says otherwise. */
	get rollsTo(): Audience {
		return this.role === TABLE_ROLE.gm ? app.tableGmRollsTo : app.tablePlayerRollsTo;
	}
	set rollsTo(to: Audience) {
		if (this.role === TABLE_ROLE.gm) app.tableGmRollsTo = to;
		else app.tablePlayerRollsTo = to;
	}

	/**
	 * Keep the table told for as long as this app is seated: whenever what the table sees of the
	 * open character changes, say so, and write every roll the sheet makes into the table's log.
	 * Started once by the layout; answers the way to stop.
	 */
	keepPublishing = (): (() => void) => {
		combat.journal.onRecorded = (entries) => {
			if (this.role !== TABLE_ROLE.none) this.log.share(entries, this.rollsTo);
		};
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
			combat.journal.onRecorded = undefined;
			clearTimeout(settling);
			stop();
		};
	};
}

export const table = new TableVM();
