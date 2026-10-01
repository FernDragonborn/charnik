<script module lang="ts">
	import type { CharacterSheet } from '$lib/character/derive';

	/** Whether the strip would draw anything — a host that puts a box and a heading around it must
	 *  not draw them around nothing. */
	export function hasDefenseChips(sheet: CharacterSheet): boolean {
		const { resist, immune, vulnerable } = sheet.damageSensitivities;
		return (
			resist.length + immune.length + vulnerable.length > 0 ||
			sheet.conditionImmunities.length > 0 ||
			sheet.qualifiedDefenses.length > 0 ||
			sheet.incomingAttacks.length > 0 ||
			Object.values(sheet.senses).some((sense) => sense.value > 0)
		);
	}
</script>

<script lang="ts">
	// What is true of this character's BODY, as labelled groups of chips. The play sheet and the
	// builder ask the same question, so both render this and neither can know a kind the other lacks.
	//
	// A group names what MOVES — a damage bucket, YOUR number (`AC`), YOUR roll (`Saves`) — and the one
	// group whose die is somebody else's says so (`Against you`). The CASE a statement holds in goes in
	// the chip and never in the label: a qualified defence and an incoming attack can both be "only
	// against spells", so a scope cannot be what tells two groups apart.
	//
	// It renders the groups and nothing around them. Whoever mounts it owns the box, the heading, and
	// the `container-type` the one-group-per-line rule below measures against.
	import { _ } from '$lib/i18n';
	import type { ContentGraph } from '$lib/content/loader';
	import type { System } from '$lib/rules/pipeline';
	import { damageTypeLabel, senseLabel } from '$lib/combat/attacks';
	import { why } from '$lib/combat/effects-view';
	import { provenance } from '$lib/actions/provenance';
	import { signed } from '$lib/util/format';
	import { stateLabel } from '$lib/content/states';
	import { app } from '$lib/stores/app.svelte';

	let {
		sheet,
		graph,
		system,
	}: { sheet: CharacterSheet; graph: ContentGraph | null; system: System } = $props();

	/** How a chip is drawn: the three damage buckets, a plain fact, a statement that helps, and one
	 *  that hurts. `incoming` is a boon about a die this character does not roll. */
	type Tone = 'resist' | 'immune' | 'vulnerable' | 'plain' | 'boon' | 'incoming' | 'bane';
	interface Chip {
		id: string;
		text: string;
		tone: Tone;
		/** Where it comes from, or how its number was reached — the popover's text. */
		why: string;
	}
	interface Group {
		id: string;
		chips: Chip[];
	}

	/** The word for a qualifier after "against" — a NOUN ("against spells"). Open vocabulary like a
	 *  damage type: a pack may write its own, and one nobody has translated reads as written. */
	const qualifierLabel = (scope: string) => $_(`qualifier.${scope}`, { default: scope });
	/** …and the same qualifier where it MODIFIES a noun — "spell attacks". English needs a different
	 *  word in the two positions; Ukrainian parenthesises it, so its entries are the nominative gloss. */
	const qualifierAttributive = (scope: string) =>
		$_(`qualifierAttributive.${scope}`, { default: scope });

	const damageChips = (types: string[], tone: Tone): Chip[] =>
		types.map((type) => ({ id: type, text: damageTypeLabel(type, $_), tone, why: '' }));

	const groups = $derived.by((): Group[] => {
		const { resist, immune, vulnerable } = sheet.damageSensitivities;
		// a condition you cannot be given joins the DAMAGE immunities under one "Immune" rather than
		// standing under a second label saying the same word
		const conditions: Chip[] = graph
			? sheet.conditionImmunities.map((id) => ({
					id: `condition:${id}`,
					text: stateLabel(graph, system, id, app.activeLocale),
					tone: 'immune',
					why: '',
				}))
			: [];

		// one group per target, in the order the facts arrived: a pack's own qualified target gets a
		// group of its own without this file hearing about it
		const qualified = new Map<string, Chip[]>();
		for (const [i, q] of sheet.qualifiedDefenses.entries()) {
			const kind = qualifierLabel(q.scope);
			const chip: Chip = {
				id: `${q.target}:${i}`,
				text:
					q.swing === undefined
						? $_('combat.defense.bonus', { values: { amount: signed(q.amount ?? 0), kind } })
						: $_(`combat.defense.swing.${q.swing}`, { values: { kind } }),
				tone: q.swing === 'disadvantage' || (q.amount ?? 0) < 0 ? 'bane' : 'boon',
				why: q.source,
			};
			qualified.set(q.target, [...(qualified.get(q.target) ?? []), chip]);
		}

		const attacked: Chip[] = sheet.incomingAttacks.map((a, i) => ({
			id: `attacked:${i}`,
			text: a.scope
				? $_(`combat.defense.attackedScoped.${a.swing}`, {
						values: { kind: qualifierAttributive(a.scope) },
					})
				: $_(`combat.defense.attacked.${a.swing}`),
			// the attacker's advantage is this character's bad news
			tone: a.swing === 'advantage' ? 'bane' : 'incoming',
			why: a.source,
		}));

		const senses: Chip[] = Object.entries(sheet.senses)
			.filter(([, comp]) => comp.value > 0)
			.map(([name, comp]) => ({
				id: name,
				text: $_('combat.defense.sense', {
					values: { sense: senseLabel(name, $_), feet: comp.value },
				}),
				tone: 'plain',
				why: why(comp, $_),
			}));

		return [
			{ id: 'resist', chips: damageChips(resist, 'resist') },
			{ id: 'immune', chips: [...damageChips(immune, 'immune'), ...conditions] },
			{ id: 'vulnerable', chips: damageChips(vulnerable, 'vulnerable') },
			...[...qualified].map(([id, chips]) => ({ id, chips })),
			{ id: 'attacked', chips: attacked },
			{ id: 'senses', chips: senses },
		].filter((group) => group.chips.length);
	});
</script>

{#if groups.length}
	<div class="def-groups">
		{#each groups as group (group.id)}
			<span class="def-group">
				<span class="def-label">{$_(`combat.sensitivity.${group.id}`, { default: group.id })}</span>
				<span class="def-chips">
					{#each group.chips as chip (chip.id)}<span
							class="def-chip def-chip--{chip.tone}"
							use:provenance={chip.why}>{chip.text}</span
						>{/each}
				</span>
			</span>
		{/each}
	</div>
{/if}

<style>
	.def-groups {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2) 14px;
		flex: 1 1 0;
		min-width: 0;
	}
	.def-group {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-1-5);
		min-width: 0;
	}
	.def-label {
		font-family: var(--font-body);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.def-chips {
		display: inline-flex;
		flex-wrap: wrap;
		gap: var(--space-1-5);
		min-width: 0;
	}
	/* Once a chip can be a whole sentence, two groups on one line leave neither enough room: the label
	   breaks across two words and the chip wraps mid-phrase. One group per line, behind a label column
	   of one width, fixes both — measured against whichever box the strip was mounted in, because the
	   builder's card is narrow on a wide screen. */
	@container (max-width: 560px) {
		.def-group {
			display: flex;
			width: 100%;
		}
		.def-label {
			flex: 0 0 5.25rem;
		}
	}
	/* The chip colour encodes protection — resist (teal outline) → immune (teal filled) → vulnerable
	   (danger) — and gold is the neutral marker a conditional statement wears. No `text-transform`: the
	   label that builds the string owns its capitals, and a sentence must not be capitalised per word. */
	.def-chip {
		font-family: var(--font-body);
		font-weight: 400;
		font-size: var(--font-size-xs);
		line-height: 1.6;
		padding: 1px var(--space-2);
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border-strong);
		color: var(--color-text);
	}
	.def-chip--resist {
		border-color: var(--color-good-line);
		color: var(--color-good);
	}
	.def-chip--immune {
		border-color: var(--color-good-line);
		background: var(--color-good-soft);
		color: var(--color-good);
	}
	.def-chip--vulnerable,
	.def-chip--bane {
		border-color: color-mix(in srgb, var(--color-danger) 45%, var(--color-surface));
		color: var(--color-danger);
	}
	/* a sense is neither good nor bad news, so it keeps the neutral chip and only the group label
	   tells it apart from the defences beside it */
	.def-chip--plain {
		color: var(--color-text-muted);
	}
	.def-chip--boon {
		border-color: var(--color-resource-line);
		color: var(--color-resource);
	}
	/* filled, because it is the one statement about a die this character does not roll */
	.def-chip--incoming {
		border-color: var(--color-resource-line);
		background: var(--color-resource-soft);
		color: var(--color-resource);
	}
</style>
