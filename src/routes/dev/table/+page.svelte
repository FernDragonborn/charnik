<script lang="ts">
	// DEV-ONLY PREVIEW — the Table screen in each of its states, with nobody on the other end.
	//
	// A table needs the desktop app with the `table-link` feature and a second app to sit across
	// from, so this fills the view-model by hand and mounts the real screen: `?seat=gm`,
	// `?seat=player&state=waiting|connected|reconnecting`, `?seat=none&problem=<reason>`, and
	// `&ask=damage|roll|effect|unknown` to raise the request prompt over it.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { loadContentStore } from '$lib/content/store.svelte';
	import {
		CONNECTION,
		REQUESTED_ROLL,
		TABLE_REQUEST,
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

	// the screen is mounted once the state is in place, so its own loads find nothing left to do
	let seeded = $state(false);

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
		table.requests = ask
			? [
					{ requestId: 'r-1', request: ask },
					{ requestId: 'r-2', request: ASKS.roll },
				]
			: [];
		seeded = true;
	});
</script>

{#if seeded}
	<TablePage />
{/if}
