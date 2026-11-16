/*
 * The Table view-model against a table link that reaches nobody: what a GM's seat keeps of the
 * players at it, and what a player's seat does with what the GM asks — on the real sheet, through
 * the sheet's own actions.
 */
import 'fake-indexeddb/auto'; // accepting a request saves the character
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { registerDiceTray } from '$lib/dice/tray.svelte';
import { rollPool } from '$lib/rules/dice';
import { loadPacks } from '../../test-support/real-content';
import type { ContentGraph } from '$lib/content/loader';
import type { Character } from '$lib/character/schema';
import { demoCharacter } from '$lib/demo/sheet';
import { startI18n, locale, waitLocale } from '$lib/i18n';
import {
	CLOSE_REASON,
	CONNECTION,
	DELIVERY,
	REQUESTED_ROLL,
	SEATING,
	TABLE_ANSWER,
	TABLE_EVENT,
	TABLE_REQUEST,
	UNAVAILABLE,
	type GmEvent,
	type GmSeat,
	type HeldSeat,
	type PlayerEvent,
	type PlayerSeat,
	type TableAnswer,
	type TableLink,
	type TableRequest,
	type TableRole,
} from '$lib/table-link/types';
import { tableViewOf } from '$lib/table-link/view';
import type { TableView } from '$lib/table-link/wire-schema';
import { combat } from '../combat/combat-view-model.svelte';
import { ASK_STATUS, NO_CHARACTER, TABLE_ROLE, TableVM } from './table-view-model.svelte';
import type { PendingRequest } from './player-requests.svelte';
import { rollPassed } from './requested-roll';

const NO_SEAT_HELD = () => Promise.resolve({ role: TABLE_ROLE.none });

/** A table link whose other side is this test. `held` is the seat the app kept from a page that
 *  was here before. */
function tableOfOne(held: TableRole = TABLE_ROLE.none) {
	const heard = {
		views: [] as TableView[],
		answers: [] as { requestId: string; answer: TableAnswer }[],
		requests: [] as { participant: string; request: TableRequest }[],
		dismissed: [] as string[],
		left: 0,
		redials: 0,
	};
	let toPlayer: (event: PlayerEvent) => void = () => {};
	let toGm: (event: GmEvent) => void = () => {};
	const playerSeat: PlayerSeat = {
		table: 'table-1',
		code: '123-456',
		leave: () => Promise.resolve(void heard.left++),
		subscribe: (listener) => {
			toPlayer = listener;
			return Promise.resolve(() => {});
		},
		publish: (character, sheet) => {
			heard.views.push(tableViewOf(character, sheet));
			return Promise.resolve(DELIVERY.delivered);
		},
		respond: (requestId, answer) => {
			heard.answers.push({ requestId, answer });
			return Promise.resolve(DELIVERY.delivered);
		},
		redial: () => Promise.resolve(void heard.redials++),
	};
	const gmSeat: GmSeat = {
		table: 'table-1',
		invite: 'charnik-table:first',
		leave: () => Promise.resolve(void heard.left++),
		subscribe: (listener) => {
			toGm = listener;
			return Promise.resolve(() => {});
		},
		request: (participant, request) => {
			heard.requests.push({ participant, request });
			return Promise.resolve(
				participant === 'gone'
					? { delivery: DELIVERY.notDelivered }
					: { delivery: DELIVERY.delivered, requestId: `r-${heard.requests.length}` },
			);
		},
		dismiss: (participant) => Promise.resolve(void heard.dismissed.push(participant)),
		setDoor: (open) => Promise.resolve(open ? 'charnik-table:second' : null),
	};
	const link: TableLink = {
		available: () => Promise.resolve(true),
		host: () => Promise.resolve({ status: SEATING.seated, seat: gmSeat }),
		join: () => Promise.resolve({ status: SEATING.seated, seat: playerSeat }),
		resume: (): Promise<HeldSeat> => {
			if (held === TABLE_ROLE.gm)
				return Promise.resolve({ role: held, seat: gmSeat, name: 'Thursday' });
			if (held === TABLE_ROLE.player) return Promise.resolve({ role: held, seat: playerSeat });
			return NO_SEAT_HELD();
		},
	};
	return {
		table: new TableVM(() => link),
		heard,
		tellPlayer: (event: PlayerEvent) => toPlayer(event),
		tellGm: (event: GmEvent) => toGm(event),
	};
}

let graph: ContentGraph;
let character: Character;

beforeAll(async () => {
	await startI18n('en');
	void locale.set('en');
	await waitLocale();
	graph = await loadPacks('srd-2024');
});

beforeEach(() => {
	character = demoCharacter();
	combat.graph = graph;
	combat.character = character;
	combat.journal.log = [];
});

/** Seat the open character and have the GM ask one thing of it. */
async function askedOf(request: TableRequest, requestId = 'r-1') {
	const seated = tableOfOne();
	await seated.table.join('an invite');
	seated.tellPlayer({ kind: TABLE_EVENT.connection, state: CONNECTION.connected });
	seated.tellPlayer({ kind: TABLE_EVENT.request, requestId, request });
	const pending = seated.table.asks.requests[0] as PendingRequest;
	return { ...seated, pending };
}

describe("a player's seat", () => {
	it('sits as the open character and says what its sheet says once it is let in', async () => {
		const { table, heard, tellPlayer } = tableOfOne();
		await table.join('an invite');
		expect(table.role).toBe(TABLE_ROLE.player);
		expect(table.code).toBe('123-456');
		expect(heard.views).toHaveLength(0);

		tellPlayer({ kind: TABLE_EVENT.connection, state: CONNECTION.waiting });
		expect(table.connection).toBe(CONNECTION.waiting);
		tellPlayer({ kind: TABLE_EVENT.connection, state: CONNECTION.connected });
		await Promise.resolve();
		expect(heard.views.at(-1)?.name).toBe(character.build.name);
	});

	it('has nobody to sit down as without a character', async () => {
		combat.character = null;
		combat.load = () => Promise.resolve();
		const { table } = tableOfOne();
		await table.join('an invite');
		expect(table.role).toBe(TABLE_ROLE.none);
		expect(table.problem).toBe(NO_CHARACTER);
	});

	it('takes a hit the GM sends through its own defenses, and only on a press', async () => {
		const { table, heard, pending } = await askedOf({
			kind: TABLE_REQUEST.damage,
			amount: 10,
			type: 'fire',
		});
		const before = character.play.hp.current + character.play.hp.temp;
		expect(character.play.hp.current + character.play.hp.temp).toBe(before);

		await table.asks.accept(pending);
		// the demo character resists fire: ten becomes five
		expect(character.play.hp.current + character.play.hp.temp).toBe(before - 5);
		expect(heard.answers).toEqual([
			{ requestId: 'r-1', answer: { outcome: TABLE_ANSWER.accepted } },
		]);
		expect(table.asks.requests).toEqual([]);
	});

	it('is healed by what the GM sends', async () => {
		const { table, pending } = await askedOf({ kind: TABLE_REQUEST.heal, amount: 4 });
		const before = character.play.hp.current;
		await table.asks.accept(pending);
		expect(character.play.hp.current).toBe(before + 4);
	});

	it('takes a state by its catalog id, once', async () => {
		const { table, pending } = await askedOf({ kind: TABLE_REQUEST.effect, id: 'prone' });
		expect(combat.sheet?.facts.conditions).not.toContain('prone');
		await table.asks.accept(pending);
		expect(combat.sheet?.facts.conditions).toContain('prone');

		const again = await askedOf({ kind: TABLE_REQUEST.effect, id: 'prone' }, 'r-2');
		const count = character.play.effects.length;
		await again.table.asks.accept(again.pending);
		expect(character.play.effects).toHaveLength(count);
	});

	it('makes the roll it was asked for the way the sheet makes it, and sends it back', async () => {
		const { table, heard, pending } = await askedOf({
			kind: TABLE_REQUEST.roll,
			roll: REQUESTED_ROLL.savingThrow,
			id: 'wis',
			dc: 12,
		});
		await table.asks.accept(pending);

		const made = combat.journal.log.find((entry) => entry.labelKey === 'combat.roll.save.wis');
		expect(made).toBeDefined();
		const roll = heard.answers[0]?.answer.roll;
		expect(roll?.total).toBe(made?.total);
		expect(roll?.natural).toBeGreaterThanOrEqual(1);
		// the sheet's own bonus, not a number the GM sent
		expect(roll?.mod).toBe(combat.sheet?.abilities.wis.save.value);
		// an announced DC is answered on the player's side too
		const verdict = rollPassed(roll!, 12) ? 'table.notice.passed' : 'table.notice.failed';
		expect(combat.journal.log.some((entry) => entry.labelKey === verdict)).toBe(true);
	});

	describe('a roll built in the dice tray', () => {
		let unregister: () => void = () => {};
		const saveOfWisdom: TableRequest = {
			kind: TABLE_REQUEST.roll,
			roll: REQUESTED_ROLL.savingThrow,
			id: 'wis',
		};
		/** What the tray's Roll press hands the sheet: a throw the player may have added to. */
		const trayThrows = (extra: number) =>
			combat.recordTrayRolls([
				combat.journal.entryFor(
					{ text: 'Wisdom save', key: 'combat.roll.save.wis' },
					rollPool({ 20: 1 }, { mod: (combat.sheet?.abilities.wis.save.value ?? 0) + extra }),
				),
			]);
		beforeEach(() => {
			unregister = registerDiceTray(() => {});
		});
		afterEach(() => unregister());

		it('is offered only where a tray is mounted', async () => {
			const { table, pending } = await askedOf(saveOfWisdom);
			expect(table.asks.canBuildInTray(pending.request)).toBe(true);
			unregister();
			expect(table.asks.canBuildInTray(pending.request)).toBe(false);
			const hit = await askedOf({ kind: TABLE_REQUEST.heal, amount: 1 });
			expect(hit.table.asks.canBuildInTray(hit.pending.request)).toBe(false);
		});

		it('answers with what the tray rolled, the player’s additions included', async () => {
			const { table, heard, pending } = await askedOf(saveOfWisdom);
			await table.asks.buildInTray(pending);
			expect(table.asks.requests).toEqual([]);
			expect(table.asks.inTray).toBe(pending);
			expect(heard.answers).toEqual([]);

			trayThrows(4);
			await vi.waitFor(() => expect(heard.answers).toHaveLength(1));
			const made = combat.journal.log[0];
			expect(heard.answers[0]?.answer.roll?.total).toBe(made?.total);
			expect(heard.answers[0]?.answer.roll?.mod).toBe(
				(combat.sheet?.abilities.wis.save.value ?? 0) + 4,
			);
			expect(table.asks.inTray).toBeNull();

			// the next roll the tray makes is the player's own
			trayThrows(0);
			await Promise.resolve();
			expect(heard.answers).toHaveLength(1);
		});

		it('is asked again when another roll was built over it in the tray', async () => {
			const { table, heard, pending } = await askedOf(saveOfWisdom);
			await table.asks.buildInTray(pending);
			combat.rolls.recordTrayRolls([
				combat.journal.entryFor(
					{ text: 'STR check', key: 'combat.roll.check.str' },
					rollPool({ 20: 1 }, { mod: 0 }),
				),
			]);
			await Promise.resolve();
			expect(heard.answers).toEqual([]);
			expect(table.asks.requests).toEqual([pending]);
		});

		it('is asked again when the tray is put away unrolled', async () => {
			const { table, heard, pending } = await askedOf(saveOfWisdom);
			await table.asks.buildInTray(pending);
			combat.rolls.trayPutAway();
			expect(table.asks.requests).toEqual([pending]);
			expect(table.asks.inTray).toBeNull();

			trayThrows(0);
			await Promise.resolve();
			expect(heard.answers).toEqual([]);
		});
	});

	it('can only decline what names nothing its sheet has', async () => {
		const unknownSkill = await askedOf({
			kind: TABLE_REQUEST.roll,
			roll: REQUESTED_ROLL.skill,
			id: 'basket_weaving',
		});
		expect(unknownSkill.table.asks.canAccept(unknownSkill.pending.request)).toBe(false);
		await unknownSkill.table.asks.accept(unknownSkill.pending);
		expect(unknownSkill.heard.answers).toEqual([]);
		await unknownSkill.table.asks.decline(unknownSkill.pending);
		expect(unknownSkill.heard.answers).toEqual([
			{ requestId: 'r-1', answer: { outcome: TABLE_ANSWER.declined } },
		]);

		const unknownState = await askedOf({ kind: TABLE_REQUEST.effect, id: 'no_such_state' });
		expect(unknownState.table.asks.canAccept(unknownState.pending.request)).toBe(false);
	});

	it('keeps one of a repeated request, and declines unseen what it has no room for', async () => {
		const { table, heard, tellPlayer } = await askedOf({ kind: TABLE_REQUEST.heal, amount: 1 });
		tellPlayer({
			kind: TABLE_EVENT.request,
			requestId: 'r-1',
			request: { kind: TABLE_REQUEST.heal, amount: 999 },
		});
		expect(table.asks.requests).toHaveLength(1);

		for (let n = 2; n <= 40; n++)
			tellPlayer({
				kind: TABLE_EVENT.request,
				requestId: `r-${n}`,
				request: { kind: TABLE_REQUEST.heal, amount: 1 },
			});
		expect(table.asks.requests.length).toBeLessThan(40);
		const declined = heard.answers.filter(({ answer }) => answer.outcome === TABLE_ANSWER.declined);
		expect(table.asks.requests.length + declined.length).toBe(40);
	});

	it('keeps its seat while the connection is down, and dials at once when asked', async () => {
		const { table, heard, tellPlayer } = tableOfOne();
		await table.join('an invite');
		tellPlayer({ kind: TABLE_EVENT.connection, state: CONNECTION.connected });
		tellPlayer({ kind: TABLE_EVENT.connection, state: CONNECTION.reconnecting });
		expect(table.role).toBe(TABLE_ROLE.player);
		expect(table.connection).toBe(CONNECTION.reconnecting);
		await table.redial();
		expect(heard.redials).toBe(1);
		// back at the table, it says its sheet again
		const told = heard.views.length;
		tellPlayer({ kind: TABLE_EVENT.connection, state: CONNECTION.connected });
		await Promise.resolve();
		expect(heard.views.length).toBe(told + 1);
	});

	it('says why the seat ended, and holds none afterwards', async () => {
		const { table, heard, tellPlayer } = await askedOf({ kind: TABLE_REQUEST.heal, amount: 1 });
		tellPlayer({
			kind: TABLE_EVENT.connection,
			state: CONNECTION.closed,
			reason: CLOSE_REASON.dismissed,
		});
		await Promise.resolve();
		expect(table.role).toBe(TABLE_ROLE.none);
		expect(table.problem).toBe(CLOSE_REASON.dismissed);
		expect(table.asks.requests).toEqual([]);
		expect(heard.left).toBe(1);
	});
});

describe("a GM's seat", () => {
	const lira = { id: 'p-1', name: 'Lira' };
	async function hosting() {
		const seated = tableOfOne();
		await seated.table.host('Thursday');
		seated.tellGm({ kind: TABLE_EVENT.participantJoined, participant: lira });
		return seated;
	}

	it('keeps who sat down, the sheet they show, and that they dropped', async () => {
		const { table, tellGm } = await hosting();
		expect(table.role).toBe(TABLE_ROLE.gm);
		expect(table.invite).toBe('charnik-table:first');
		expect(table.players).toEqual([{ ...lira, view: null, present: true }]);

		const view = tableViewOf(character, combat.sheet!);
		tellGm({ kind: TABLE_EVENT.view, participant: 'p-1', view });
		expect(table.players[0]?.view?.hp).toEqual(view.hp);
		// a sheet from nobody at the table is nobody's
		tellGm({ kind: TABLE_EVENT.view, participant: 'p-9', view });
		expect(table.players).toHaveLength(1);

		tellGm({ kind: TABLE_EVENT.participantLeft, participant: 'p-1' });
		expect(table.players[0]?.present).toBe(false);
		tellGm({ kind: TABLE_EVENT.participantJoined, participant: lira });
		expect(table.players).toHaveLength(1);
		expect(table.players[0]?.present).toBe(true);
		expect(table.players[0]?.view).not.toBeNull();
	});

	it('holds a roll to its DC whether or not the player was told it', async () => {
		const { table, heard, tellGm } = await hosting();
		const request = { kind: TABLE_REQUEST.roll, roll: REQUESTED_ROLL.skill, id: 'stealth' };
		await table.ask(['p-1'], request, 15);
		expect(heard.requests).toEqual([{ participant: 'p-1', request }]);
		expect(table.asked[0]).toMatchObject({ name: 'Lira', dc: 15, status: ASK_STATUS.pending });

		const roll = { total: 17, natural: 14, advantage: 'neither', mod: 3 } as const;
		// only the one who was asked answers
		tellGm({
			kind: TABLE_EVENT.answer,
			participant: 'p-9',
			requestId: 'r-1',
			answer: { outcome: TABLE_ANSWER.accepted, roll },
		});
		expect(table.asked[0]?.status).toBe(ASK_STATUS.pending);
		tellGm({
			kind: TABLE_EVENT.answer,
			participant: 'p-1',
			requestId: 'r-1',
			answer: { outcome: TABLE_ANSWER.accepted, roll },
		});
		expect(table.asked[0]).toMatchObject({ status: ASK_STATUS.accepted, roll });
		// and only once
		tellGm({
			kind: TABLE_EVENT.answer,
			participant: 'p-1',
			requestId: 'r-1',
			answer: { outcome: TABLE_ANSWER.declined },
		});
		expect(table.asked[0]?.status).toBe(ASK_STATUS.accepted);
	});

	it('keeps no row for a request that reached nobody', async () => {
		const { table } = await hosting();
		await table.ask(['gone'], { kind: TABLE_REQUEST.heal, amount: 1 });
		expect(table.asked).toEqual([]);
	});

	it('shuts and reopens the door, dismisses a player, and closes the table', async () => {
		const { table, heard } = await hosting();
		await table.setDoor(false);
		expect(table.invite).toBeNull();
		await table.setDoor(true);
		expect(table.invite).toBe('charnik-table:second');

		await table.dismiss('p-1');
		expect(heard.dismissed).toEqual(['p-1']);
		expect(table.players).toEqual([]);

		await table.leave();
		expect(table.role).toBe(TABLE_ROLE.none);
		expect(table.problem).toBeNull();
		expect(heard.left).toBe(1);
	});
});

describe('a page that loads again', () => {
	const lira = { id: 'p-1', name: 'Lira' };

	it("picks up the GM's table: its name, its invitation, and who the app says is at it", async () => {
		const { table, tellGm, heard } = tableOfOne(TABLE_ROLE.gm);
		await table.resume();
		expect(table.role).toBe(TABLE_ROLE.gm);
		expect(table.tableName).toBe('Thursday');
		expect(table.invite).toBe('charnik-table:first');
		// the log of asks was the page's own
		expect(table.asked).toEqual([]);

		const view = tableViewOf(character, combat.sheet!);
		tellGm({ kind: TABLE_EVENT.participantJoined, participant: lira });
		tellGm({ kind: TABLE_EVENT.view, participant: 'p-1', view });
		expect(table.players).toEqual([{ ...lira, view, present: true }]);

		// and it is a seat like any other: it asks, and it closes the table
		await table.ask(['p-1'], { kind: TABLE_REQUEST.heal, amount: 2 });
		expect(heard.requests).toHaveLength(1);
		await table.leave();
		expect(heard.left).toBe(1);
	});

	it("picks up a player's seat, says its sheet again, and shows what still waits", async () => {
		const { table, tellPlayer, heard } = tableOfOne(TABLE_ROLE.player);
		await table.resume();
		expect(table.role).toBe(TABLE_ROLE.player);
		expect(table.code).toBe('123-456');

		tellPlayer({ kind: TABLE_EVENT.connection, state: CONNECTION.connected });
		await Promise.resolve();
		expect(heard.views.at(-1)?.name).toBe(character.build.name);
		tellPlayer({
			kind: TABLE_EVENT.request,
			requestId: 'r-1',
			request: { kind: TABLE_REQUEST.heal, amount: 2 },
		});
		expect(table.asks.requests).toHaveLength(1);
	});

	describe('with somewhere to keep a log', () => {
		beforeEach(() => {
			const kept = new Map<string, string>();
			vi.stubGlobal('sessionStorage', {
				getItem: (key: string) => kept.get(key) ?? null,
				setItem: (key: string, value: string) => void kept.set(key, value),
				removeItem: (key: string) => void kept.delete(key),
			});
		});
		afterEach(() => vi.unstubAllGlobals());

		it("finds the GM's log of asks, and an answer the last page missed lands on its row", async () => {
			const before = tableOfOne();
			await before.table.host('Thursday');
			before.tellGm({ kind: TABLE_EVENT.participantJoined, participant: lira });
			const request = { kind: TABLE_REQUEST.roll, roll: REQUESTED_ROLL.skill, id: 'stealth' };
			await before.table.ask(['p-1'], request, 15);

			// the page goes and another loads over the same seat
			const { table, tellGm } = tableOfOne(TABLE_ROLE.gm);
			await table.resume();
			expect(table.asked).toMatchObject([
				{ requestId: 'r-1', name: 'Lira', request, dc: 15, status: ASK_STATUS.pending },
			]);
			const roll = { total: 17, natural: 14, advantage: 'neither', mod: 3 } as const;
			tellGm({
				kind: TABLE_EVENT.answer,
				participant: 'p-1',
				requestId: 'r-1',
				answer: { outcome: TABLE_ANSWER.accepted, roll },
			});
			expect(table.asked[0]).toMatchObject({ status: ASK_STATUS.accepted, roll });

			// and the answer is kept too: a third page sees the row answered
			const third = tableOfOne(TABLE_ROLE.gm);
			await third.table.resume();
			expect(third.table.asked[0]).toMatchObject({ status: ASK_STATUS.accepted, roll });

			// a table that is over leaves no log for the next one
			await third.table.leave();
			const after = tableOfOne(TABLE_ROLE.gm);
			await after.table.resume();
			expect(after.table.asked).toEqual([]);
		});
	});

	it('holds nothing where the app holds no seat, and leaves a seat already held alone', async () => {
		const { table } = tableOfOne();
		await table.resume();
		expect(table.role).toBe(TABLE_ROLE.none);
		expect(table.busy).toBe(false);

		await table.host('Thursday');
		await table.ask([], { kind: TABLE_REQUEST.heal, amount: 1 });
		await table.resume();
		expect(table.role).toBe(TABLE_ROLE.gm);
	});
});

describe('a seat that was not given', () => {
	it('says why', async () => {
		const refusing: TableLink = {
			available: () => Promise.resolve(false),
			host: () =>
				Promise.resolve({ status: SEATING.unavailable, reason: UNAVAILABLE.relayUnreachable }),
			join: () => Promise.resolve({ status: SEATING.unavailable, reason: UNAVAILABLE.badInvite }),
			resume: NO_SEAT_HELD,
		};
		const table = new TableVM(() => refusing);
		expect(await table.checkAvailable()).toBe(false);
		await table.host('Thursday');
		expect(table.problem).toBe(UNAVAILABLE.relayUnreachable);
		await table.join('nonsense');
		expect(table.problem).toBe(UNAVAILABLE.badInvite);
		expect(table.role).toBe(TABLE_ROLE.none);
	});
});

describe('whether the build has a table', () => {
	it('is asked once, and the first answer stands', async () => {
		let asked = 0;
		const link: TableLink = {
			available: () => Promise.resolve(++asked === 1),
			host: () => Promise.resolve({ status: SEATING.unavailable, reason: UNAVAILABLE.noTable }),
			join: () => Promise.resolve({ status: SEATING.unavailable, reason: UNAVAILABLE.noTable }),
			resume: NO_SEAT_HELD,
		};
		const table = new TableVM(() => link);
		expect(await Promise.all([table.checkAvailable(), table.checkAvailable()])).toEqual([
			true,
			true,
		]);
		expect(await table.checkAvailable()).toBe(true);
		expect(asked).toBe(2);
	});
});

describe('a roll against a DC', () => {
	it('passes on meeting it, and a forced outcome decides over the number', () => {
		const roll = { total: 15, advantage: 'neither', mod: 2 } as const;
		expect(rollPassed(roll, 15)).toBe(true);
		expect(rollPassed(roll, 16)).toBe(false);
		expect(rollPassed({ ...roll, outcome: 'fail' }, 5)).toBe(false);
		expect(rollPassed({ ...roll, total: 0, outcome: 'succeed' }, 30)).toBe(true);
	});
});
