/*
 * What the GM asked of this player, waiting for a press, and what a press does. A request is
 * carried out by the SAME actions a click on the sheet uses (`combat.act`, the sheet's rolls, the
 * effects picker's switch), so what a GM's damage does to a sheet is what the player's own Damage
 * press does (`docs/internals/table-link.md` ▸ What a request does on a sheet).
 */
import { toast } from '#lib/toast/toast.ts';
import { t } from '#lib/i18n/index.ts';
import { saveCharacterGuarded } from '#lib/character/store.svelte.ts';
import type { RollLogEntry } from '#lib/combat/roll.ts';
import { diceTrayIsLive } from '#lib/dice/tray.svelte.ts';
import { heal, takeDamage } from '#lib/play/hit-points.ts';
import {
	DELIVERY,
	TABLE_ANSWER,
	TABLE_REQUEST,
	type Delivery,
	type RequestId,
	type TableAnswer,
	type TableRequest,
} from '#lib/table-link/types.ts';
import type { TableRoll } from '#lib/table-link/wire-schema.ts';
import type { StateChoice } from '../combat/effects-editor.svelte';
import { combat } from '../combat/combat-view-model.svelte';
import {
	isRollNamed,
	requestedRollSpec,
	rollPassed,
	tableRollOf,
	type RollRequest,
} from './requested-roll';

/** Something the GM asked of this player, waiting for a press. */
export interface PendingRequest {
	requestId: RequestId;
	request: TableRequest;
}

/** How many requests may wait for the player at once; one past that is declined unseen, so a GM's
 *  app cannot fill the player's screen or memory. */
const PENDING_MAX = 12;

/** How this seat tells the GM an answer, and whether it got there. */
export type Respond = (requestId: RequestId, answer: TableAnswer) => Promise<Delivery | undefined>;

export class PlayerRequests {
	constructor(private respond: Respond) {}

	/** Oldest first: the prompt shows the first. */
	requests = $state<PendingRequest[]>([]);

	/** Keep what the GM asked until it is answered; one past the cap is declined unseen. */
	queue(pending: PendingRequest): void {
		if (this.requests.some((waiting) => waiting.requestId === pending.requestId)) return;
		if (this.requests.length >= PENDING_MAX) {
			void this.respond(pending.requestId, { outcome: TABLE_ANSWER.declined });
			return;
		}
		this.requests = [...this.requests, pending];
	}

	/** Nothing waits any more: the seat is new, or gone. */
	clear(): void {
		this.requests = [];
		this.stopBuildingInTray();
	}

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
		await this.answerAccepted(pending, this.carryOut(pending.request));
	};

	/** Can this roll be built in the dice tray first? Only where a tray is mounted — the play screen;
	 *  anywhere else a roll is made at once. */
	canBuildInTray = (request: TableRequest): boolean =>
		request.kind === TABLE_REQUEST.roll && diceTrayIsLive() && this.canAccept(request);

	/**
	 * Open the asked roll in the dice tray, where the player can add what the sheet does not know
	 * (Guidance, a helper's advantage) before rolling. The tray's roll is the answer; a tray put away
	 * unrolled puts the request back in front of the player, because nothing was answered.
	 */
	buildInTray = async (pending: PendingRequest): Promise<void> => {
		const { request } = pending;
		if (!this.requests.includes(pending) || request.kind !== TABLE_REQUEST.roll) return;
		const spec = combat.sheet ? requestedRollSpec(request, combat.sheet) : null;
		if (!spec || !this.canBuildInTray(request)) return;
		this.requests = this.requests.filter((waiting) => waiting !== pending);
		this.stopBuildingInTray();
		const before = combat.journal.log[0];
		if (!combat.rolls.rollInTray(spec.name, spec.mod, spec.target)) {
			// a condition decided the roll, so there is nothing to build: it is answered as it stands
			await this.answerAccepted(pending, this.readBack(request, combat.journal.log[0], before));
			return;
		}
		this.inTray = pending;
		combat.rolls.handNextTrayRollTo({
			rolled: (entries) => {
				this.inTray = null;
				const entry = entries[0];
				// another roll built over this one in the tray is the player's own, not the answer
				if (entry && isRollNamed(entry, spec.name))
					void this.answerAccepted(pending, this.readBack(request, entry, undefined));
				else this.requests = [pending, ...this.requests];
			},
			putAway: () => {
				this.inTray = null;
				this.requests = [pending, ...this.requests];
			},
		});
	};

	/** The roll the GM asked for, open in the dice tray and not rolled yet. */
	inTray = $state<PendingRequest | null>(null);

	/** The request in front of the player: the first that waits, unless a roll is being built in the
	 *  tray, which it would cover. */
	get shown(): PendingRequest | undefined {
		return this.inTray ? undefined : this.requests[0];
	}

	/** True while the play screen's playbar stands wide enough to hold a request: it is answered
	 *  there, beside the sheet, and the dialog is for every other screen. */
	playbarHolds = $state(false);

	/** What a hit comes to once this character's defense against its type applies. */
	defendedOf = (request: TableRequest) =>
		request.kind === TABLE_REQUEST.damage
			? combat.hp.previewOf({ amount: request.amount, type: request.type })
			: null;

	/** Why a request this sheet cannot carry out can only be declined. */
	cannotSay = (request: TableRequest): string =>
		request.kind === TABLE_REQUEST.effect
			? t('table.prompt.cannotEffect', { id: request.id })
			: t('table.prompt.cannotRoll');

	private stopBuildingInTray(): void {
		if (this.inTray) combat.rolls.handNextTrayRollTo(null);
		this.inTray = null;
	}

	private async answerAccepted(
		pending: PendingRequest,
		roll: TableRoll | undefined,
	): Promise<void> {
		// the play screen's autosave is not running on every screen a request can arrive over
		if (combat.character) void saveCharacterGuarded(combat.character);
		await this.answer(pending.requestId, {
			outcome: TABLE_ANSWER.accepted,
			...(roll ? { roll } : {}),
		});
	}

	decline = async (pending: PendingRequest): Promise<void> => {
		if (!this.requests.includes(pending)) return;
		this.requests = this.requests.filter((waiting) => waiting !== pending);
		await this.answer(pending.requestId, { outcome: TABLE_ANSWER.declined });
	};

	private async answer(requestId: RequestId, answer: TableAnswer): Promise<void> {
		const delivery = await this.respond(requestId, answer);
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
	private rollFor(request: RollRequest): TableRoll | undefined {
		const spec = combat.sheet ? requestedRollSpec(request, combat.sheet) : null;
		if (!spec) return undefined;
		const before = combat.journal.log[0];
		// a plain event rolls at once; `buildInTray` is the way through the tray
		combat.roll(spec.name, spec.mod, new Event('table-request'), spec.target);
		return this.readBack(request, combat.journal.log[0], before);
	}

	/** The roll that answers a request, read off its log entry — none when the roll left no entry.
	 *  An announced DC is said on this side as passed or failed. */
	private readBack(
		request: RollRequest,
		entry: RollLogEntry | undefined,
		before: RollLogEntry | undefined,
	): TableRoll | undefined {
		if (!entry || entry === before) return undefined;
		const roll = tableRollOf(entry);
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
