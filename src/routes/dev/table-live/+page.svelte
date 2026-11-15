<script lang="ts">
	// DEV-ONLY LIVE PROBE — a real table, hosted by the running desktop app.
	//
	// The transport is proven inside a Rust test and the screen over hand-made state; this is the
	// piece between them: the commands, the native questions, the events crossing into the webview,
	// their schema, and the view-model, with a real peer at the other end. It opens a table with
	// NO relay, so nothing leaves this machine, and its player is a second process:
	//
	//   cargo test --features table-link -- --ignored a_live_player_sits_at_the_apps_table
	//
	// with `CHARNIK_LIVE_TABLE` naming the `.table-live` folder this page writes into. The two
	// native questions it raises — open the table, let the player in — are answered by whoever is
	// driving it (`docs/internals/table-link.md` ▸ Driving a live table).
	import { onMount } from 'svelte';
	import { deriveSheet } from '$lib/character/derive';
	import { getContentGraph } from '$lib/content/provider';
	import { demoCharacter } from '$lib/demo/sheet';
	import { app } from '$lib/stores/app.svelte';
	import { detectPlatform, getUserStorage, Platform } from '$lib/storage/provider';
	import { REQUESTED_ROLL, RELAY_MODE, TABLE_REQUEST } from '$lib/table-link/types';
	import { tableViewOf } from '$lib/table-link/view';
	import {
		ASK_STATUS,
		TABLE_ROLE,
		rollPassed,
		table,
		type TableRole,
	} from '../../table/table-view-model.svelte';
	import { firstDifference } from './first-difference';

	const REPORT = 'table-live-probe.txt';
	const FOLDER = '.table-live';
	const TABLE_NAME = 'Probe table';
	/** How long the other end has to do its part of a step. */
	const STEP_WAIT_MS = 120_000;
	const POLL_MS = 250;

	let lines = $state<string[]>([]);
	let failures = $state(0);
	let ran = $state(false);
	const say = (line: string): void => {
		lines = [...lines, line];
	};
	function check(what: string, ok: boolean, detail = ''): void {
		if (!ok) failures += 1;
		say(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` — ${detail}`}`);
	}
	async function until(what: string, holds: () => boolean): Promise<boolean> {
		const deadline = Date.now() + STEP_WAIT_MS;
		while (!holds() && Date.now() < deadline) await new Promise((r) => setTimeout(r, POLL_MS));
		check(what, holds(), holds() ? '' : 'not in time');
		return holds();
	}

	/** The seat as it is NOW: a call between two reads of it may have given it up. */
	const seatHeld = (): TableRole => table.role;

	onMount(async () => {
		const storage = getUserStorage();
		// the setting is the user's: the probe borrows it and puts it back
		const relay = app.tableRelay;
		try {
			await probe();
		} catch (e) {
			check('the probe ran to the end', false, String(e));
		} finally {
			app.tableRelay = relay;
			if (table.role !== TABLE_ROLE.none) await table.leave();
		}
		say(!ran ? '\nNOT RUN HERE' : failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
		await storage
			.write(REPORT, lines.join('\n'))
			.catch((e: unknown) => say(`report not written: ${String(e)}`));
	});

	async function probe(): Promise<void> {
		say(`platform: ${detectPlatform()}`);
		if (detectPlatform() !== Platform.Desktop || !(await table.checkAvailable())) {
			say('NOT a desktop build with the table link. Nothing run.');
			return;
		}
		ran = true;
		const storage = getUserStorage();

		// --- 1. the app opens a table once the person says so ----------------------------------------
		app.tableRelay = { mode: RELAY_MODE.none };
		await table.host(TABLE_NAME);
		check('a table is open', table.role === TABLE_ROLE.gm, table.problem ?? '');
		if (table.role !== TABLE_ROLE.gm || !table.invite) return;
		const first = table.invite;
		say(`     the invitation is ${first.length} characters`);

		// --- 2. a player in another process is handed the invitation and a sheet to show -------------
		const character = demoCharacter();
		const view = tableViewOf(character, deriveSheet(character, await getContentGraph()));
		await storage.mkdir(FOLDER).catch(() => {});
		await storage.write(`${FOLDER}/view.json`, JSON.stringify(view));
		await storage.write(`${FOLDER}/invite.txt`, first);

		if (
			!(await until('the player the GM let in is at the table', () => table.players.length === 1))
		)
			return;
		const [player] = table.players;
		if (!player) return;
		say(`     seated as "${player.name}"`);
		await until('their sheet arrived, and is the sheet they sent', () => !!player.view);
		const changed = firstDifference(view, player.view, 'view');
		check('…name, hit points and AC intact', changed === null, changed ?? '');

		// --- 3. the GM asks, and what comes back is the answer to that ask ---------------------------
		await table.ask(
			[player.id],
			{ kind: TABLE_REQUEST.roll, roll: REQUESTED_ROLL.savingThrow, id: 'dex', dc: 15 },
			15,
		);
		const roll = () => table.asked.find((row) => row.request.kind === TABLE_REQUEST.roll);
		await until(
			'a roll that was asked for comes back',
			() => roll()?.status === ASK_STATUS.accepted,
		);
		const made = roll()?.roll;
		check(
			'…as the roll the player made',
			made?.total === 17 && made.natural === 15,
			JSON.stringify(made),
		);
		check('…and it passes the DC it was held to', !!made && rollPassed(made, 15));

		await table.ask([player.id], { kind: TABLE_REQUEST.damage, amount: 9, type: 'fire' });
		const hit = () => table.asked.find((row) => row.request.kind === TABLE_REQUEST.damage);
		await until('a hit the player declines says so', () => hit()?.status === ASK_STATUS.declined);

		// --- 4. the door, and the way out -------------------------------------------------------------
		await table.setDoor(false);
		check('shutting the door takes the invitation away', table.invite === null);
		await table.setDoor(true);
		check('opening it makes a new one', !!table.invite && table.invite !== first);
		await table.leave();
		check('the table is closed', seatHeld() === TABLE_ROLE.none);
	}
</script>

<h1>Dev · live table probe</h1>
<p>
	Opens a table with no relay and waits for a player in another process. Report also written to
	<code>{REPORT}</code> in your data folder.
</p>
<pre>{lines.join('\n')}</pre>

<style>
	h1 {
		font-family: var(--font-display);
		font-size: var(--font-size-h4);
		margin: 0 0 var(--space-2);
	}
	pre {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		white-space: pre-wrap;
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
	}
</style>
