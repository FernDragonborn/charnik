<script lang="ts">
	// DEV-ONLY preview of the dice tray (docs/internals/roller.md).
	// The dice tray is a live thing — typing, a menu, a caret — so the preview drives the REAL
	// `DiceTray` with a fixture vocabulary rather than rendering fixed markup. Every button below
	// is a starting state; the roller itself is the same one the dice tray mounts.
	// Not linked from the app; gated to dev builds by /dev/+layout.
	import Roller from '$lib/components/Roller.svelte';
	import RollRow from '$lib/components/RollRow.svelte';
	import { rollToastModel } from '$lib/dice/roll-toast';
	import { DiceTray } from '$lib/dice/dice-tray.svelte';
	import { rollerCandidates, type NamedRollSource } from '$lib/dice/roller-vocabulary';
	import { rollerSources } from '$lib/dice/roller-sources';
	import { ROLLER_ROLE, addToken, emptyLine } from '$lib/dice/roller';
	import { candidateResolver } from '$lib/dice/roller-vocabulary';
	import type { RollLogEntry } from '$lib/combat/roll';

	// a fixture stand-in for "what this character has on and what the compendium knows". Two of them
	// are ACTIVE, which is what puts them above the rest with the dot.
	const FIXTURE: NamedRollSource[] = [
		{
			key: 'bless',
			names: { en: 'Bless', uk: 'Благословення' },
			tokens: ['flat_bonus:attack+1d4'],
			active: true,
		},
		{
			key: 'bane',
			names: { en: 'Bane', uk: 'Благання' },
			tokens: ['flat_bonus:attack-1d4'],
			active: false,
		},
		{
			key: 'trickster_blessing',
			names: { en: 'Blessing of the Trickster' },
			tokens: ['advantage:skill.stealth'],
			active: true,
		},
		{
			key: 'rage',
			names: { en: 'Rage' },
			tokens: ['flat_bonus:damage+2'],
			active: true,
		},
		{
			key: 'shield_of_faith',
			names: { en: 'Shield of Faith' },
			tokens: ['flat_bonus:ac+2'],
			active: false,
		},
		// the mode words and the damage types come from the app's own bridge, so the preview offers
		// exactly what the tray does (localized names included)
		...rollerSources(null, undefined, []),
	];

	const diceTray = new DiceTray();
	diceTray.candidates = rollerCandidates(FIXTURE, 'en');
	const resolve = candidateResolver(diceTray.candidates);

	let rolled = $state<RollLogEntry[] | null>(null);

	/** Build a line by typing tokens into it — the only way the app ever builds one. */
	const line = (role: (typeof ROLLER_ROLE)[keyof typeof ROLLER_ROLE], ...tokens: string[]) =>
		tokens.reduce((l, t) => addToken(l, t, resolve), emptyLine(role));

	function preset(label: string, ...lines: ReturnType<typeof line>[]): void {
		diceTray.reset();
		diceTray.label = label;
		diceTray.lines = lines;
		diceTray.drafts = lines.map(() => '');
		diceTray.focus = 0;
		rolled = null;
	}

	const CASES: { title: string; run: () => void }[] = [
		{ title: 'ad hoc — the same dice tray with an empty body', run: () => diceTray.reset() },
		{
			title: 'a check — one line, no damage half at all',
			run: () => preset('Perception', line(ROLLER_ROLE.test, 'd20', '+4')),
		},
		{
			title: 'an attack — a test and a damage line, each with its own state toggle',
			run: () =>
				preset(
					'Greataxe',
					line(ROLLER_ROLE.test, 'd20', 'bless', '+7', 'adv'),
					line(ROLLER_ROLE.damage, '1d12', 'rage', '+4', 'slashing'),
				),
		},
		{
			title: 'damage types — everything left of a type is its, and the tail inherits it',
			run: () => preset('Flame Tongue', line(ROLLER_ROLE.damage, '2d6', '+3', 'fire', '1d8')),
		},
		{
			title: 'a homebrew type with no glyph stays a word, and still rolls',
			run: () => preset('Ichor Lash', line(ROLLER_ROLE.damage, '2d6', 'ichor')),
		},
		{
			title: 'Reliable Talent — a floor is a property of the DIE',
			run: () => preset('Stealth', line(ROLLER_ROLE.test, 'd20', '>10', '+11')),
		},
		{
			title: 'a volley — one set of dice, N times',
			run: () =>
				preset(
					'Scorching Ray',
					line(ROLLER_ROLE.test, 'd20', '+7', '×3'),
					line(ROLLER_ROLE.damage, '2d6', 'fire'),
				),
		},
		{
			title: 'pure damage, no test — Fireball: the target saves, not you',
			run: () => preset('Fireball', line(ROLLER_ROLE.damage, '8d6', 'fire')),
		},
		{
			title: 'a fragment it can’t account for — the roll is held and the button goes muted',
			run: () => preset('Cure Wounds', line(ROLLER_ROLE.damage, '1d8', '+2', '+d4?')),
		},
		{
			title: 'a label you wrote yourself — not an error, and it blocks nothing',
			run: () => preset('Inspiration', line(ROLLER_ROLE.test, 'd20', '1d6', 'dm’s luck')),
		},
	];
</script>

<div class="page">
	<h1>Dice tray</h1>
	<p class="hint">
		The live dice tray with a fixture vocabulary. Type into a line: a space parses the token, a
		letter opens the menu, <code>Tab</code> completes, <code>Ctrl</code>+<code>Enter</code> rolls.
	</p>

	<div class="cases">
		{#each CASES as c (c.title)}
			<button class="case" onclick={c.run}>{c.title}</button>
		{/each}
	</div>

	<Roller {diceTray} onroll={(entries) => (rolled = entries)} />

	{#if rolled}
		<div class="result"><RollRow model={rollToastModel(rolled)} /></div>
	{/if}
</div>

<style>
	.page {
		max-width: 620px;
		margin: 0 auto;
		padding: var(--space-4);
	}
	h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-xl);
		margin: 0 0 var(--space-2);
	}
	.hint {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin: 0 0 var(--space-4);
	}
	.cases {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: 20px;
	}
	.case {
		padding: var(--space-1-5) var(--space-2-5);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--color-text);
		font-family: var(--font-body);
		font-size: var(--font-size-xs);
		text-align: start;
		cursor: pointer;
	}
	.case:hover {
		border-color: var(--color-accent);
	}
	.result {
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
	}
</style>
