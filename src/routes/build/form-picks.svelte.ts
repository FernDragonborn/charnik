/*
 * Known forms: the stat blocks a character has chosen AHEAD of time for a form they may assume —
 * 2024 Wild Shape's Known Forms. Whether a form is chosen ahead at all, how many, and which stat
 * blocks are eligible are the feature's own `form` statements (`effects/facts.ts` ▸ `FormRules`),
 * so this reads the drafted sheet's facts and knows nothing of druids. A form whose rules state no
 * count asks nothing here: 2014 Wild Shape takes any eligible beast at the table.
 */
import type { FormRules } from '$lib/effects/facts';
import { isEligibleForm, type MonsterRow } from '$lib/character/forms';
import { isRowActive } from '$lib/content/sources.svelte';
import { rowName } from './rows';
import { toggleCapped } from './draft';
import type { BuildVM } from './build-view-model.svelte';

/** What the picker needs from the build view-model around it. */
export type FormPicksHost = Pick<BuildVM, 'draft' | 'graph' | 'sheet'>;

/** One form whose stat blocks are chosen ahead: its rules, what may be chosen, and what is. */
export interface KnownFormChoice {
	rules: FormRules;
	cap: number;
	options: MonsterRow[];
	/** The picks, as monster refs, trimmed to what is still eligible and to the cap. */
	picks: string[];
}

export class FormPicks {
	/* The host arrives as an ACCESSOR: a `$derived` field initialiser runs before a constructor
	   parameter property is assigned. */
	constructor(private host: () => FormPicksHost) {}

	/** Every form this character chooses ahead of time. Empty for a character with none, which is
	 *  everyone who is not a 2024 druid. */
	choices = $derived.by<KnownFormChoice[]>(() => {
		const { graph, sheet, draft } = this.host();
		if (!graph || !sheet) return [];
		const stat = graph.list('monster', { system: draft.system }).filter((row) => isRowActive(row));
		return sheet.facts.forms.flatMap((rules) => {
			if (rules.known === undefined) return [];
			const options = stat
				.filter((row) => isEligibleForm(row, rules))
				.sort((a, b) => rowName(a).localeCompare(rowName(b)));
			const eligible = new Set(options.map((row) => row.effectiveId));
			// a pick the level no longer allows is dropped, like every other capped pick here
			const picks = (draft.forms[rules.id] ?? []).filter((ref) => eligible.has(ref));
			return [{ rules, cap: rules.known, options, picks: picks.slice(0, rules.known) }];
		});
	});

	/** How many forms are still to choose, across every form that asks. */
	owed = $derived(this.choices.reduce((n, c) => n + Math.max(c.cap - c.picks.length, 0), 0));
	chosen = $derived(this.choices.reduce((n, c) => n + c.picks.length, 0));
	cap = $derived(this.choices.reduce((n, c) => n + c.cap, 0));

	/** Toggle one stat block. At the cap a click REPLACES the oldest pick (ui.md §10). */
	toggle = (choice: KnownFormChoice, monster: string) => {
		const draft = this.host().draft;
		draft.forms = {
			...draft.forms,
			[choice.rules.id]: toggleCapped(choice.picks, monster, choice.cap),
		};
	};
}
