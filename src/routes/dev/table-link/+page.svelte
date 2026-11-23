<script lang="ts">
	// DEV-ONLY LIVE PROBE — the table link's seam on the built app, in either build.
	//
	// The commands, their capability file and the page's adapter come and go with one Cargo
	// feature, and that is a fact about a BUILD: nothing but the running webview can say whether a
	// command is there. Open it as `/dev/table-link?expect=off` on a plain build and `?expect=on`
	// on one built with `--features table-link`; the probe fails if the build is not the one named.
	//
	// It opens no table and reaches nobody: every call here is one Rust answers BEFORE it would
	// ask the person at the app anything, so no native dialog appears and no socket is bound.
	import { onMount } from 'svelte';
	import { invokeRaw } from '../invoke-raw';
	import { page } from '$app/state';
	import { deriveSheet } from '#lib/character/derive.ts';
	import { getContentGraph } from '#lib/content/provider.ts';
	import { demoCharacter } from '#lib/demo/sheet.ts';
	import { detectPlatform, getUserStorage, Platform } from '#lib/storage/provider.ts';
	import {
		DELIVERY,
		RELAY_MODE,
		REQUESTED_ROLL,
		SEATING,
		TABLE_ANSWER,
		TABLE_REQUEST,
		UNAVAILABLE,
		type TableAnswer,
		type TableRequest,
	} from '#lib/table-link/types.ts';
	import { tableViewOf } from '#lib/table-link/view.ts';

	const REPORT = 'table-link-probe.txt';
	const EXPECT_ON = 'on';
	const COMMANDS = [
		'host',
		'join',
		'leave',
		'publish',
		'respond',
		'request',
		'dismiss',
		'door',
	].map((call) => `table_link_${call}`);

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

	async function answers(
		what: string,
		expected: unknown,
		command: string,
		args: Record<string, unknown>,
	): Promise<void> {
		const outcome = await invokeRaw(command, args);
		check(
			what,
			outcome.resolved && outcome.value === expected,
			outcome.resolved ? `answered ${JSON.stringify(outcome.value)}` : outcome.reason,
		);
	}

	async function refused(what: string, command: string, args: Record<string, unknown>) {
		const outcome = await invokeRaw(command, args);
		check(what, !outcome.resolved, outcome.resolved ? 'it answered' : outcome.reason);
	}

	onMount(async () => {
		try {
			await probe();
		} catch (e) {
			check('the probe ran to the end', false, String(e));
		}
		say(!ran ? '\nNOT RUN HERE' : failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
		await getUserStorage()
			.write(REPORT, lines.join('\n'))
			.catch((e: unknown) => say(`report not written: ${String(e)}`));
	});

	async function probe(): Promise<void> {
		const expectOn = page.url.searchParams.get('expect') === EXPECT_ON;
		say(`platform: ${detectPlatform()} · expecting the feature ${expectOn ? 'ON' : 'OFF'}`);
		if (detectPlatform() !== Platform.Desktop) {
			say('NOT the desktop app — the build is the thing under test. Nothing run.');
			return;
		}
		ran = true;

		if (expectOn) await probeFeatureOn();
		else
			for (const command of COMMANDS)
				await refused(`${command} is not the page's to call`, command, { table: 'probe' });
	}

	/** A call Rust turns away before asking anybody: the answer names why, and no dialog showed. */
	async function turnedAway(what: string, reason: string, command: string, args: object) {
		const outcome = await invokeRaw(command, { locale: 'en', ...args });
		const answered = outcome.resolved ? JSON.stringify(outcome.value) : outcome.reason;
		check(
			what,
			outcome.resolved &&
				JSON.stringify(outcome.value) === JSON.stringify({ status: SEATING.unavailable, reason }),
			`answered ${answered}`,
		);
	}

	async function probeFeatureOn(): Promise<void> {
		// --- 1. no table is opened or joined on what is not a name, a relay or an invitation --------
		const n0 = { mode: RELAY_MODE.n0 };
		await turnedAway('a table needs a name', UNAVAILABLE.badName, 'table_link_host', {
			name: ' ',
			relay: n0,
		});
		await turnedAway('a relay is a web address over TLS', UNAVAILABLE.badRelay, 'table_link_host', {
			name: 'probe',
			relay: { mode: RELAY_MODE.custom, url: 'http://relay.example.org' },
		});
		await refused('a relay setting of no known mode is refused', 'table_link_host', {
			name: 'probe',
			relay: { mode: 'tor' },
			locale: 'en',
		});
		await turnedAway(
			'an invitation is one this app made',
			UNAVAILABLE.badInvite,
			'table_link_join',
			{
				invite: 'charnik-table:not-one',
				name: 'probe',
			},
		);
		await turnedAway('a seat needs a name', UNAVAILABLE.badName, 'table_link_join', {
			invite: 'charnik-table:not-one',
			name: '',
		});

		// --- 2. with no seat, every call a seat makes is read by Rust and delivered to nobody -------
		const undelivered = DELIVERY.notDelivered;
		const character = demoCharacter();
		const view = tableViewOf(character, deriveSheet(character, await getContentGraph()));
		say(`     a table's view of a sheet is ${JSON.stringify(view).length} bytes`);
		await answers('a view is taken', undelivered, 'table_link_publish', { table: 'probe', view });
		const requests: TableRequest[] = [
			{ kind: TABLE_REQUEST.damage, amount: 7, type: 'fire' },
			{ kind: TABLE_REQUEST.damage, amount: 7, type: null },
			{ kind: TABLE_REQUEST.heal, amount: 5 },
			{ kind: TABLE_REQUEST.effect, id: 'poisoned' },
			{ kind: TABLE_REQUEST.roll, roll: REQUESTED_ROLL.savingThrow, id: 'dex', dc: 15 },
			{ kind: TABLE_REQUEST.roll, roll: REQUESTED_ROLL.skill, id: 'stealth' },
			{ kind: TABLE_REQUEST.roll, roll: REQUESTED_ROLL.abilityCheck, id: 'str' },
		];
		for (const request of requests)
			await answers(
				`a request is taken: ${JSON.stringify(request)}`,
				undelivered,
				'table_link_request',
				{ table: 'probe', participant: 'nobody', requestId: 'r-1', request },
			);
		const answer: TableAnswer = { outcome: TABLE_ANSWER.declined };
		await answers('an answer is taken', undelivered, 'table_link_respond', {
			table: 'probe',
			requestId: 'r-1',
			answer,
		});
		await answers('no door opens on no table', null, 'table_link_door', {
			table: 'probe',
			open: true,
			locale: 'en',
		});
		await answers('dismissing nobody answers', false, 'table_link_dismiss', {
			table: 'probe',
			participant: 'nobody',
			locale: 'en',
		});
		await answers('leaving no table answers', null, 'table_link_leave', { table: 'probe' });
		await answers('no seat is held where none was taken', null, 'table_link_resume', {});
		await answers('a dial asked for at no table answers', null, 'table_link_redial', {
			table: 'probe',
		});

		// --- 3. a request is ids and numbers, and Rust holds it to that ------------------------------
		const asking = { table: 'probe', participant: 'nobody', requestId: 'r-1' };
		await refused('a request carrying tokens is refused', 'table_link_request', {
			...asking,
			request: { kind: TABLE_REQUEST.effect, id: 'poisoned', tokens: ['ac+5'] },
		});
		await refused('a request of no known kind is refused', 'table_link_request', {
			...asking,
			request: { kind: 'formula', formula: '100d100' },
		});
		await refused('an answer carrying more than an answer is refused', 'table_link_respond', {
			table: 'probe',
			requestId: 'r-1',
			answer: { outcome: TABLE_ANSWER.accepted, apply: ['hp-10'] },
		});
	}
</script>

<h1>Dev · table link probe</h1>
<p>
	Opens no table and asks nothing. Report also written to <code>{REPORT}</code> in your data folder.
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
