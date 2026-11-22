<script lang="ts">
	// DEV-ONLY PREVIEW — the Table screen in each of its states, with nobody on the other end.
	//
	// A table needs the desktop app with the `table-link` feature and a second app to sit across
	// from, so this fills the view-model by hand and mounts the real screen: `?seat=gm`,
	// `?seat=player&state=waiting|connected|reconnecting`, `?seat=none&problem=<reason>`, and
	// `&ask=damage|roll|effect|unknown` to raise the request prompt over it. `&tray` mounts the play
	// screen's dice tray, so a roll can be built in it as on that screen. `&log` fills the table's log, and `&remembered` lists two tables to return to.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { loadContentStore } from '$lib/content/store.svelte';
	import {
		AUDIENCE,
		CONNECTION,
		LOG_BODY,
		REQUESTED_ROLL,
		TABLE_EVENT,
		TABLE_REQUEST,
		type Audience,
		type ConnectionState,
		type TableRequest,
	} from '$lib/table-link/types';
	import { tableViewOf } from '$lib/table-link/view';
	import type { TableView } from '$lib/table-link/wire-schema';
	import { combat } from '../../combat/combat-view-model.svelte';
	import {
		ASK_STATUS,
		TABLE_ROLE,
		table,
		type TableProblem,
	} from '../../table/table-view-model.svelte';
	import TablePage from '../../table/+page.svelte';
	import CombatMenus from '../../combat/CombatMenus.svelte';

	const ASKS = {
		damage: { kind: TABLE_REQUEST.damage, amount: 12, type: 'fire' },
		roll: { kind: TABLE_REQUEST.roll, roll: REQUESTED_ROLL.savingThrow, id: 'dex', dc: 15 },
		effect: { kind: TABLE_REQUEST.effect, id: 'prone' },
		unknown: { kind: TABLE_REQUEST.effect, id: 'homebrew_curse' },
	} as const satisfies Record<string, TableRequest>;
	const askNamed = (name: string | null): TableRequest | undefined =>
		Object.entries(ASKS).find(([key]) => key === name)?.[1];

	function seatGm(own: TableView): void {
		const down: TableView = {
			...own,
			name: 'Lira Swiftfoot',
			level: 3,
			hp: { current: 0, max: 24, temp: 0 },
			deathSaves: { successes: 1, failures: 2 },
			conditions: ['unconscious', 'prone'],
			effects: [],
			concentration: null,
		};
		table.role = TABLE_ROLE.gm;
		table.tableName = 'Thursday game';
		table.invite =
			'charnik-table:eyJ2IjoxLCJpZCI6IjNmYTg1ZjY0NTcxNzQ1NjJiM2ZjMmM5NjNmNjZhZmE2IiwicmVsYXkiOiJodHRwczovL2V1dzEtMS5yZWxheS5uMC5pcm9oLmxpbmsuLyJ9';
		table.players = [
			{ id: 'p-1', name: own.name, view: own, present: true },
			{ id: 'p-2', name: down.name, view: down, present: true },
			{ id: 'p-3', name: 'Bevan', view: { ...own, name: 'Bevan', level: 2 }, present: false },
			{ id: 'p-4', name: 'Newcomer', view: null, present: true },
		];
		const save = { kind: TABLE_REQUEST.roll, roll: REQUESTED_ROLL.savingThrow, id: 'dex' } as const;
		const rolled = { advantage: 'neither', mod: 2 } as const;
		table.asked = [
			{
				requestId: 'r-5',
				participant: 'p-1',
				name: own.name,
				request: ASKS.effect,
				status: ASK_STATUS.pending,
			},
			{
				requestId: 'r-4',
				participant: 'p-2',
				name: down.name,
				request: save,
				dc: 15,
				status: ASK_STATUS.accepted,
				roll: { ...rolled, total: 0, outcome: 'fail' },
			},
			{
				requestId: 'r-3',
				participant: 'p-1',
				name: own.name,
				request: save,
				dc: 15,
				status: ASK_STATUS.accepted,
				roll: { ...rolled, total: 17, natural: 15 },
			},
			{
				requestId: 'r-2',
				participant: 'p-1',
				name: own.name,
				request: ASKS.damage,
				status: ASK_STATUS.accepted,
			},
			{
				requestId: 'r-1',
				participant: 'p-2',
				name: down.name,
				request: { kind: TABLE_REQUEST.heal, amount: 7 },
				status: ASK_STATUS.declined,
			},
		];
	}

	/** A few rolls from around the table: the GM's, a player's kept to the GM, one hidden, this app's. */
	function fillLog(): void {
		const gm = 'gm-key';
		const rollRecord = (
			author: string,
			seq: number,
			minutesAgo: number,
			total: number,
			to: Audience = AUDIENCE.table,
		) => ({
			table: gm,
			author,
			seq,
			at: Date.now() - minutesAgo * 60_000,
			body: {
				kind: LOG_BODY.roll,
				lines: [
					{
						name: { text: 'DEX save', key: 'combat.roll.save.dex' },
						roll: { total, natural: total - 2, advantage: 'neither', mod: 2 },
					},
				],
				to,
			} as const,
		});
		const heard = [
			{ record: rollRecord('lira', 1, 9, 17), name: 'Lira Swiftfoot', mine: false },
			{ record: rollRecord(gm, 1, 7, 11), mine: false },
			{ record: rollRecord('lira', 2, 5, 4, AUDIENCE.gm), name: 'Lira Swiftfoot', mine: false },
			{ record: rollRecord('me', 1, 2, 20), mine: true },
			// this app's own roll kept to the GM, which it can show the table
			{ record: rollRecord(gm, 2, 1, 14, AUDIENCE.gm), mine: true },
			{
				record: {
					...rollRecord('bevan', 1, 1, 9),
					body: { kind: LOG_BODY.hide, author: 'lira', seq: 9 } as const,
				},
				mine: false,
			},
		];
		for (const event of heard) table.log.take({ kind: TABLE_EVENT.record, ...event });
	}

	// the screen is mounted once the state is in place, so its own loads find nothing left to do
	let seeded = $state(false);
	const withTray = page.url.searchParams.has('tray');

	onMount(() => (withTray ? combat.registerTray() : undefined));

	onMount(async () => {
		await loadContentStore();
		await combat.load();
		const { character, sheet } = combat;
		if (!character || !sheet) return;
		const asked = page.url.searchParams;
		table.available = true;
		const seat = asked.get('seat');
		if (seat === TABLE_ROLE.gm) seatGm(tableViewOf(character, sheet));
		else if (seat === TABLE_ROLE.player) {
			table.role = TABLE_ROLE.player;
			table.code = '482-917';
			table.connection = (asked.get('state') as ConnectionState | null) ?? CONNECTION.waiting;
		} else {
			table.role = TABLE_ROLE.none;
			table.problem = asked.get('problem') as TableProblem | null;
		}
		const ask = askNamed(asked.get('ask'));
		table.asks.requests = ask
			? [
					{ requestId: 'r-1', request: ask },
					{ requestId: 'r-2', request: ASKS.roll },
				]
			: [];
		if (asked.has('log')) fillLog();
		// the screen asks the link on mount, and the web build's link remembers nothing
		if (asked.has('remembered'))
			table.loadRemembered = () => {
				table.remembered = [
					{ table: 'a1', role: TABLE_ROLE.gm, name: 'Thursday game' },
					{ table: 'b2', role: TABLE_ROLE.player, name: 'Curse of the Sunday' },
				];
				return Promise.resolve();
			};
		seeded = true;
	});
</script>

{#if seeded}
	<TablePage />
	{#if withTray}<CombatMenus />{/if}
{/if}
