/*
 * Assuming and leaving a FORM (a druid's Wild Shape) on the play sheet.
 *
 * A form is two things in play-state, the way concentration is: `play.form` says which stat block
 * and which rules, and an ordinary CARRIER effect in `play.effects` — its `source` the same monster
 * ref — carries the stat block's numbers and the form's clock. So the form shows in the Effects panel
 * with its timer, passing time expires it, and its ✕ ends it, all on paths that already exist.
 *
 * Whose hit points are counted, and putting them back, is `$lib/play/form-shift` and
 * `$lib/play/settle`; what this module owns is the question the picker asks and what it offers.
 */
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import type { ContentGraph } from '$lib/content/loader';
import { localizedName } from '$lib/content/detail';
import { isRowActive } from '$lib/content/sources.svelte';
import { app } from '$lib/stores/app.svelte';
import type { FormRules } from '$lib/effects/facts';
import { activeForm, isEligibleForm, type MonsterRow } from '$lib/character/forms';
import { assumeForm, leaveFormNow, revertForm, setFormWorn } from '$lib/play/form-shift';
import { FORM_SHEDS } from '$lib/effects/token-words';
import { FORM_SPECIES } from '$lib/character/schema';
import type { PlayContext, PlayOutcome } from '$lib/play/outcome';
/** What the form bookkeeping needs from the sheet around it. */
export interface FormHost {
	character: Character | null;
	sheet: CharacterSheet | null;
	graph: ContentGraph | null;
	outcomes: { settle(): void };
	/** Carry out a play-state action on the open character; false when it was refused. */
	act(action: (character: Character, ctx: PlayContext) => PlayOutcome): boolean;
}

/** The open question: which stat block of these to assume, and what to do with the answer. */
interface FormQuestion {
	rules: FormRules;
	options: MonsterRow[];
	answer(monster: string): void;
}

export class FormShift {
	constructor(private host: () => FormHost) {}

	/** The picker is open on this question, or null. Asked BEFORE anything is paid, so backing out of
	 *  it costs nothing. */
	asking = $state<FormQuestion | null>(null);

	/** The form the character is in, or null: its stat block, its name in the reader's language, and
	 *  the hit points of their own that wait behind it (only a form with its own has any). */
	get current(): { row: MonsterRow; name: string; hpBefore: number | undefined } | null {
		const { character, graph } = this.host();
		const form = character && graph ? activeForm(character, graph, isRowActive) : undefined;
		return form
			? {
					row: form.row,
					name: localizedName(form.row, app.activeLocale),
					hpBefore: form.state.hpBefore,
				}
			: null;
	}

	/** The rules of one form, as the character's features state them right now. */
	rulesOf = (formId: string): FormRules | undefined =>
		this.host().sheet?.facts.forms.find((rules) => rules.id === formId);

	/**
	 * The stat blocks on offer. Strict offers what the rules allow — the forms the character KNOWS
	 * where the feature has them chosen ahead of time, every eligible one otherwise — and Free offers
	 * every stat block of the creature type, for a table that rules differently.
	 */
	optionsFor = (rules: FormRules): MonsterRow[] => {
		const { character, graph } = this.host();
		if (!character || !graph) return [];
		const rows = graph.list('monster', { system: character.system }).filter((r) => isRowActive(r));
		if (!character.ui.strict) return rows.filter((row) => isEligibleForm(row, lifted(rules)));
		const known = character.build.forms[rules.id] ?? [];
		return rules.known === undefined
			? rows.filter((row) => isEligibleForm(row, rules))
			: rows.filter((row) => known.includes(row.effectiveId) && isEligibleForm(row, rules));
	};

	/** Open the picker for one form. `answer` runs with the chosen stat block's ref. */
	ask = (formId: string, answer: (monster: string) => void): void => {
		const rules = this.rulesOf(formId);
		if (!rules) return;
		this.asking = {
			rules,
			options: this.optionsFor(rules),
			answer: (monster) => {
				this.asking = null;
				answer(monster);
			},
		};
	};

	/** Assume a form (`$lib/play/form-shift`). The effect that carries it is labelled with the stat
	 *  block's name as the reader has it. */
	assume = (formId: string, monster: string): void => {
		const label = this.nameOf(monster);
		this.host().act((c, ctx) => assumeForm(c, { form: formId, monster, label }, ctx));
	};
	/** What a stat block is called in the reader's language — the label its effect is shown under. */
	nameOf = (monster: string): string => {
		const row = this.host().graph?.get(monster);
		return row ? localizedName(row, app.activeLocale) : monster;
	};

	/** The rules of the form the character is in, or undefined. */
	private get currentRules(): FormRules | undefined {
		const id = this.host().character?.play.form?.id;
		return id === undefined ? undefined : this.rulesOf(id);
	}

	/** Does the form set the species' traits aside by its own rules? Where it does, whether THIS
	 *  table plays it so is the character's to say (`ui.formSpecies`), and the sheet offers both. */
	get shedsSpecies(): boolean {
		return this.currentRules?.sheds.includes(FORM_SHEDS.species) ?? false;
	}
	get speciesKept(): boolean {
		return this.host().character?.ui.formSpecies === FORM_SPECIES.kept;
	}
	/** Switch between the text and the table's ruling. A sheet preference, not play-state: it
	 *  outlives the form and is not a thing a rest undoes. */
	toggleSpecies = (): void => {
		const character = this.host().character;
		if (character)
			character.ui.formSpecies = this.speciesKept ? FORM_SPECIES.shed : FORM_SPECIES.kept;
	};

	/** Does equipment work in this form only where the form wears it? */
	get wornOnly(): boolean {
		return this.currentRules?.wornOnly ?? false;
	}
	isWorn = (row: string): boolean => this.host().character?.play.form?.worn.includes(row) ?? false;
	/** Say the form wears one carried item, or that it does not. */
	setWorn = (row: string, worn: boolean): void =>
		void this.host().act((c, ctx) => setFormWorn(c, { row, worn }, ctx));

	/** Leave the form by choice — a Bonus Action in both editions, which the turn has to have. */
	revert = (): void => {
		if (this.current) this.host().act(revertForm);
	};

	/** The form ends, however it ended. */
	leave = (): void => void this.host().act(leaveFormNow);

	/** What ends a form without being asked is `$lib/play/settle`; this is that, under the name the
	 *  behavioural tests call after writing play-state by hand. */
	sync = (): void => this.host().outcomes.settle();
}

/** The rules with their limits lifted: only the creature type is kept. */
const lifted = (rules: FormRules): FormRules => ({
	id: rules.id,
	source: rules.source,
	...(rules.creature !== undefined ? { creature: rules.creature } : {}),
	without: [],
	ownHp: rules.ownHp,
	casts: rules.casts,
	onlySenses: rules.onlySenses,
	endsWhen: rules.endsWhen,
	sheds: rules.sheds,
	wornOnly: rules.wornOnly,
});
