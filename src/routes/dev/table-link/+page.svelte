<script lang="ts">
	// DEV-ONLY LIVE PROBE — the table link's seam on the built app, in either build.
	//
	// The commands, their capability file and the page's adapter come and go with one Cargo
	// feature, and that is a fact about a BUILD: nothing but the running webview can say whether a
	// command is there. Open it as `/dev/table-link?expect=off` on a plain build and `?expect=on`
	// on one built with `--features table-link`; the probe fails if the build is not the one named.
	//
	// It opens no table and reaches nobody — there is no transport in either build.
	import { onMount } from 'svelte';
	import { invokeRaw } from '../invoke-raw';
	import { page } from '$app/state';
	import { deriveSheet } from '$lib/character/derive';
	import { getContentGraph } from '$lib/content/provider';
	import { demoCharacter } from '$lib/demo/sheet';
	import { detectPlatform, getUserStorage, Platform } from '$lib/storage/provider';
	import { getTableLink } from '$lib/table-link/provider';
	import { listenToTableLink, type TableLinkWireEvent } from '$lib/table-link/tauri';
	import {
		CONNECTION,
		DELIVERY,
		REQUESTED_ROLL,
		SEATING,
		TABLE_ANSWER,
		TABLE_EVENT,
		TABLE_REQUEST,
		type TableAnswer,
		type TableRequest,
	} from '$lib/table-link/types';

	const REPORT = 'table-link-probe.txt';
	const EXPECT_ON = 'on';
	/** Long enough for an event Rust sent before its command answered to be handed to the page. */
	const EVENT_WAIT_MS = 500;
	const COMMANDS = ['host', 'join', 'leave', 'publish', 'respond', 'request'].map(
		(call) => `table_link_${call}`,
	);

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

		// --- 1. the seam the app uses says no table, in both builds ---------------------------------
		const link = getTableLink();
		check('hosting gives no seat', (await link.host('probe')).status === SEATING.unavailable);
		check('joining gives no seat', (await link.join('probe')).status === SEATING.unavailable);

		if (expectOn) await probeFeatureOn();
		else
			for (const command of COMMANDS)
				await refused(`${command} is not the page's to call`, command, { table: 'probe' });
	}

	async function probeFeatureOn(): Promise<void> {
		// --- 2. Rust reaches the page down the channel -----------------------------------------------
		const heard: TableLinkWireEvent[] = [];
		const stop = await listenToTableLink((event) => heard.push(event));
		await answers('host answers no table', null, 'table_link_host', { name: 'probe' });
		await new Promise((done) => setTimeout(done, EVENT_WAIT_MS));
		stop();
		check(
			'…and says so as an event',
			heard.some(
				(event) => event.kind === TABLE_EVENT.connection && event.state === CONNECTION.unavailable,
			),
			JSON.stringify(heard),
		);
		await answers('join answers no table', null, 'table_link_join', { invite: 'probe' });
		await answers('leave answers', null, 'table_link_leave', { table: 'probe' });

		// --- 3. every call a seat makes is read by Rust, and delivered to nobody --------------------
		const undelivered = DELIVERY.notDelivered;
		const character = demoCharacter();
		const view = deriveSheet(character, await getContentGraph());
		say(`     a derived sheet is ${JSON.stringify(view).length} bytes`);
		await answers('a whole view is taken', undelivered, 'table_link_publish', {
			table: 'probe',
			character,
			view,
		});
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
				{
					table: 'probe',
					participant: 'nobody',
					request,
				},
			);
		const answer: TableAnswer = { outcome: TABLE_ANSWER.declined };
		await answers('an answer is taken', undelivered, 'table_link_respond', {
			table: 'probe',
			requestId: 'r-1',
			answer,
		});

		// --- 4. a request is ids and numbers, and Rust holds it to that ------------------------------
		await refused('a request carrying tokens is refused', 'table_link_request', {
			table: 'probe',
			participant: 'nobody',
			request: { kind: TABLE_REQUEST.effect, id: 'poisoned', tokens: ['ac+5'] },
		});
		await refused('a request of no known kind is refused', 'table_link_request', {
			table: 'probe',
			participant: 'nobody',
			request: { kind: 'formula', formula: '100d100' },
		});
	}
</script>

<h1>Dev · table link probe</h1>
<p>Opens no table. Report also written to <code>{REPORT}</code> in your data folder.</p>
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
