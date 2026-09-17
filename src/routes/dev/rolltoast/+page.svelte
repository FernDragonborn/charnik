<script lang="ts">
	// DEV-ONLY preview of the roll toast (final design — design-preview/toast-update). Toasts are
	// transient and RNG-driven, so every shape (bare check → attack → crit → miss → a flurry of
	// three) is rendered here from fixed rolls as a static ladder, plus buttons that fire the real
	// thing through toastRoll. Not linked from the app; gated to dev builds by /dev/+layout.
	import RollToast from '$lib/components/RollToast.svelte';
	import { _ } from '$lib/i18n';
	import RollRow from '$lib/components/RollRow.svelte';
	import { rollToastModel, toastRoll, ROLL_LAYOUT } from '$lib/dice/roll-toast';
	import { cycleAdvantage } from '$lib/rules/dice';
	import { toast } from 'svelte-sonner';
	import type { RollLogEntry } from '$lib/combat/helpers';
	import {
		amendedAdvantage,
		rehydrateLogEntry,
		AUTO_OUTCOME,
		type StoredRollLogEntry,
	} from '$lib/combat/roll';

	// a live entry the controls actually act on, so the preview exercises the real amend path
	let live = $state<RollLogEntry>(
		rehydrateLogEntry({
			label: 'Greataxe',
			expr: 'd20(9) +6',
			total: 15,
			natural: 9,
			damage: [{ type: 'slashing', expr: 'd12(2) +3', total: 5 }],
		}),
	);
	// the same one call the combat VM makes — the preview must exercise the real cycle, not a copy
	const onAdvantage = () => {
		const revised = cycleAdvantage(live);
		if (!revised) return;
		// the same facts the combat VM records, through the same builder
		const amendments = amendedAdvantage(live, revised);
		const { amendments: _restated, ...rest } = revised;
		live = amendments.length ? { ...rest, amendments } : rest;
	};
	const rerollDamage = {
		attack: 0,
		part: 0,
		label: 'Savage Attacker — reroll damage, keep the higher',
		run: () => toast('(preview) the damage reroll ran'),
	};

	// hand-built entries, written as `expr` strings because that is what reads clearly in a fixture
	// ladder — `rehydrateLogEntry` turns each into the structured record a live roll now produces, so
	// the preview renders through exactly the path the app does (and exercises the legacy reader while
	// it's at it). An array is one action that resolved several attacks (Extra Attack / Flurry).
	const CASES: { title: string; entry: StoredRollLogEntry | StoredRollLogEntry[] }[] = [
		{
			title: 'one roll, no damage — the toast has no damage half at all',
			entry: { label: 'Perception', expr: 'd20(14) +4', total: 18 },
		},
		{
			title: 'a plain attack — one line, one damage type',
			entry: {
				label: 'Longsword',
				expr: 'd20(14) +7',
				total: 21,
				natural: 14,
				damage: [{ type: 'slashing', expr: 'd8(8) +4', total: 12 }],
			},
		},
		{
			title: 'advantage — the die that lost stays visible, struck through',
			entry: {
				label: 'Longsword',
				expr: ' +5',
				total: 19,
				advantageRoll: { kept: 14, dropped: 7 },
				natural: 14,
				damage: [{ type: 'slashing', expr: 'd8(6) +3', total: 9 }],
			},
		},
		{
			title: 'nat 20 — the line goes gold, the doubled dice share one pill',
			entry: {
				label: 'Rapier',
				expr: 'd20(20) +9',
				total: 29,
				natural: 20,
				damage: [{ type: 'piercing', expr: 'd8(7) + d8(5) +5', total: 17 }],
			},
		},
		{
			title: 'a second damage type — its own glyph in the same line, not a second line',
			entry: {
				label: 'Flame Tongue',
				expr: 'd20(11) +8',
				total: 19,
				natural: 11,
				damage: [
					{ type: 'slashing', expr: 'd8(6) +4', total: 10 },
					{ type: 'fire', expr: 'd6(4) + d6(5)', total: 9 },
				],
			},
		},
		{
			title: 'nat 1 — the one miss callable without knowing the target’s AC',
			entry: {
				label: 'Shortbow',
				expr: 'd20(1) +6',
				total: 7,
				natural: 1,
				damage: [{ type: 'piercing', expr: 'd6(5) +4', total: 9 }],
			},
		},
		{
			title:
				'a pool big enough to WRAP — the bracket breaks inside its box rather than running off the card',
			entry: {
				label: 'Greataxe',
				expr: 'd20(9) +6',
				total: 15,
				natural: 9,
				damage: [
					{
						type: 'slashing',
						expr: 'd12(4) + d12(10) + d12(8) + d12(8) + d12(2) + d12(6) + d12(8) + d12(2) + d12(12) + d12(6) + d12(8) + d12(4) + d12(10) + d12(6) + d12(3) + d12(9) + d12(11) + d12(1) + d12(7) + d12(5) +3',
						total: 133,
					},
				],
			},
		},
		{
			title: 'a flurry — a line per attack, then the per-type footer and the one big number',
			entry: [
				{
					label: 'Flurry of Blows',
					expr: 'd20(13) +7',
					total: 20,
					natural: 13,
					damage: [
						{ type: 'bludgeoning', expr: 'd6(5) +4', total: 9 },
						{ type: 'radiant', expr: 'd4(3)', total: 3 },
						{ type: 'psychic', expr: 'd4(4)', total: 4 },
					],
				},
				{
					label: 'Flurry of Blows',
					expr: 'd20(4) +7',
					total: 11,
					natural: 4,
					damage: [
						{ type: 'bludgeoning', expr: 'd6(7) +4', total: 11 },
						{ type: 'radiant', expr: 'd4(2)', total: 2 },
						{ type: 'psychic', expr: 'd4(1)', total: 1 },
					],
				},
				{
					label: 'Flurry of Blows',
					expr: 'd20(20) +7',
					total: 27,
					natural: 20,
					damage: [
						{ type: 'bludgeoning', expr: 'd6(6) + d6(2) +4', total: 12 },
						{ type: 'radiant', expr: 'd4(4) + d4(1)', total: 5 },
						{ type: 'psychic', expr: 'd4(6) + d4(3)', total: 9 },
					],
				},
			],
		},
		{
			title: 'a roll already decided by two dice — the loser struck through',
			entry: {
				label: 'Greataxe',
				expr: ' +6',
				total: 15,
				advantageRoll: { kept: 9, dropped: 14 },
				natural: 9,
				damage: [{ type: 'slashing', expr: 'd12(2) +3', total: 5 }],
			},
		},
		{
			title: 'a save a condition decided — no die at all, the outcome said beside the name',
			entry: {
				label: 'DEX save',
				labelKey: 'combat.roll.save.dex',
				expr: '',
				total: NaN,
				outcome: AUTO_OUTCOME.fail,
			},
		},
		{
			title: 'rerolled / floored dice + an upcast note',
			entry: {
				label: 'Fireball',
				expr: 'd6(1↻5) + d6(4) + d6(6) + d6(2) + d6(1↻3) + d6(5) + d6(6) + d6(1)',
				total: 32,
				noteParts: [
					{ key: 'roller.note.upcast', values: { base: '8d6 fire', added: '1d6', slot: 4 } },
				],
			},
		},
		{
			// the legacy seam: a row written before the provenance became facts still renders its prose
			title: 'a pre-2026-09-05 row, whose note is English on disk',
			entry: {
				label: 'Fireball',
				expr: 'd6(4) + d6(6)',
				total: 10,
				note: '8d6 base + 1d6 @ slot 4',
			},
		},
	];

	const cases = CASES.map((c) => ({
		title: c.title,
		entry: Array.isArray(c.entry) ? c.entry.map(rehydrateLogEntry) : rehydrateLogEntry(c.entry),
	}));
</script>

<div class="page">
	<h1>Dev preview · Roll toast</h1>
	<p>
		The card shrinks to its content; every roll is one grid row (dice · to hit · damage · the big
		number), and only what the die did gets colour. Buttons fire the real toast through
		<code>toastRoll</code> (top-center, the app's Toaster).
	</p>

	<div class="case">
		<div class="cap">
			the SAME row mounted with controls — how the Playbar and the log show it. The toast above
			never gets these: it expires mid-decision, so it announces and these two control. Tap the d20
			to apply advantage after the fact; tap the damage pill marked with the reroll icon to reroll
			it.
		</div>
		<div class="slot live">
			<RollRow model={rollToastModel(live, $_)} {onAdvantage} {rerollDamage} />
		</div>
	</div>

	<div class="case">
		<div class="cap">
			the same rolls in the PLAYBAR's one-line layout. A strip has room for a bounded number of
			pills and a pool has no bound (Fireball is 8d6, Meteor Swarm 40), so the d20 stays — it
			decides the roll and it is the advantage control — and the rest folds into a count. Damage
			shows its part total. The card above and the log keep every die.
		</div>
		<div class="strips">
			{#each cases as c, i (i)}
				<div class="strip">
					<RollRow model={rollToastModel(c.entry, $_)} layout={ROLL_LAYOUT.strip} />
				</div>
			{/each}
		</div>
	</div>

	<div class="ladder">
		{#each cases as c, i (i)}
			<div class="case">
				<div class="cap">{c.title}</div>
				<div class="slot"><RollToast model={rollToastModel(c.entry, $_)} /></div>
				<button class="action" onclick={() => toastRoll(c.entry)}>Fire it →</button>
			</div>
		{/each}
	</div>
</div>

<style>
	.page {
		max-width: 720px;
		margin: 0 auto;
		padding: var(--space-4);
	}
	h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-xl);
		margin: 0 0 var(--space-3);
	}
	p {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		line-height: var(--line-height);
		margin: 0 0 var(--space-5);
	}
	.ladder {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.cap {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin-bottom: var(--space-1-5);
	}
	/* the toaster column, so wrapping is what the app will actually show */
	.slot {
		display: flex;
		width: 400px;
	}
	.strips {
		display: flex;
		flex-direction: column;
		gap: var(--space-1-5);
	}
	.strip {
		display: flex;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		min-height: 56px;
		overflow: hidden;
	}
	.slot.live {
		border-color: var(--color-accent);
	}
	.action {
		margin-top: var(--space-2);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		cursor: pointer;
	}
	.action:hover {
		color: var(--color-text);
		border-color: var(--color-border-strong);
	}
</style>
