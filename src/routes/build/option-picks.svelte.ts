/*
 * What a class feature has the character CHOOSE: a Pact Boon, the Eldritch Invocations. How many
 * is the feature row's own `choose` ladder and what is offered are the `option` rows that name it
 * (`content/options.ts`), so this knows nothing of warlocks — a homebrew feature with a `choose`
 * and three option rows asks the same way.
 */
import { countAtLevel } from '$lib/content/level-gate';
import { activeClassFeatures } from '$lib/character/features';
import type { LoadedRowByType } from '$lib/content/loader';
import {
	OPTION_BLOCK,
	optionAnswers,
	optionBlock,
	optionsOf,
	readPick,
	writePick,
	type OptionBlock,
	type OptionRow,
} from '$lib/content/options';
import { isRowActive } from '$lib/content/sources.svelte';
import { toggleCapped } from './draft';
import type { BuildVM } from './build-view-model.svelte';

/** What the picker needs from the build view-model around it. */
export type OptionPicksHost = Pick<BuildVM, 'draft' | 'graph'>;

/** One feature that asks: how many, out of what, and what is chosen. */
export interface FeatureChoice {
	feature: LoadedRowByType<'class_feature'>;
	/** The level of the class row the feature came from, which is what an option's own level and
	 *  the feature's ladder are both read against. */
	classLevel: number;
	cap: number;
	options: OptionRow[];
	/** The picks as `build.options` stores them — an option id, or `id.answer` for an option that
	 *  asks — trimmed to what is still offered and to the cap. */
	picks: string[];
}

export class OptionPicks {
	/* The host arrives as an ACCESSOR: a `$derived` field initialiser runs before a constructor
	   parameter property is assigned. */
	constructor(private host: () => OptionPicksHost) {}

	/** Every feature of the drafted classes that asks for a choice at the level it stands at. */
	choices = $derived.by<FeatureChoice[]>(() => {
		const { graph, draft } = this.host();
		if (!graph) return [];
		const out: FeatureChoice[] = [];
		for (const active of activeClassFeatures(draft.classes, graph, draft.system)) {
			const cap = countAtLevel(active.row.data.choose, active.entry.level);
			if (cap === 0) continue;
			const options = optionsOf(graph, active.row).filter((row) => isRowActive(row));
			const offered = new Set(options.map((option) => option.id));
			// a pick the level no longer allows is dropped, like every other capped pick here
			const picks = (draft.options[active.row.id] ?? []).filter((pick) =>
				offered.has(readPick(pick).id),
			);
			out.push({
				feature: active.row,
				classLevel: active.entry.level,
				cap,
				options,
				picks: picks.slice(0, cap),
			});
		}
		return out;
	});

	/** How many options are still to choose, across every feature that asks. */
	owed = $derived(this.choices.reduce((n, c) => n + Math.max(c.cap - c.picks.length, 0), 0));
	chosen = $derived(this.choices.reduce((n, c) => n + c.picks.length, 0));
	cap = $derived(this.choices.reduce((n, c) => n + c.cap, 0));

	/** Everything held, whichever feature asked: an invocation names a boon of another feature. */
	private held = $derived(
		new Set(this.choices.flatMap((choice) => choice.picks.map((pick) => readPick(pick).id))),
	);

	/** Is this option held by this feature, whatever its picks were answered with? */
	holds = (choice: FeatureChoice, option: OptionRow): boolean =>
		choice.picks.some((pick) => readPick(pick).id === option.id);

	/** The answers taken for one option of one feature, in the order they were picked. */
	answersTaken = (choice: FeatureChoice, option: OptionRow): string[] =>
		choice.picks.flatMap((pick) => {
			const read = readPick(pick);
			return read.id === option.id && read.answer ? [read.answer] : [];
		});

	/** What each pick of an option may name: the cantrips the draft knows that fit it. Empty for an
	 *  option that asks nothing — and for one that asks, until a fitting cantrip is chosen. */
	answersFor = (choice: FeatureChoice, option: OptionRow) => {
		const { graph, draft } = this.host();
		if (!graph || !option.data.answer) return [];
		return optionAnswers(graph, option, {
			classId: String(choice.feature.data.class_id),
			spellRefs: draft.selectedSpells,
		});
	};

	/** The picks as the build stores them, feature id → option ids. */
	picks = $derived(
		Object.fromEntries(this.choices.map((choice) => [choice.feature.id, [...choice.picks]])),
	);

	/** The option an id names, whichever feature offers it — a prerequisite is named by its id. */
	optionById = (id: string | undefined): OptionRow | undefined =>
		this.choices.flatMap((choice) => choice.options).find((option) => option.id === id);

	/** What stands between the character and one option, if anything does — its own level and
	 *  prerequisite, or the same option already taken through another feature: an option is held
	 *  once ("You can't take a Fighting Style option more than once, even if you later get to choose
	 *  again", SRD 5.1). */
	blockOf = (choice: FeatureChoice, option: OptionRow): OptionBlock | null =>
		this.takenElsewhere(choice, option) ? OPTION_BLOCK.taken : optionBlock(option, choice.classLevel, this.held);

	/** The other feature this option is already taken through, if one is. */
	takenElsewhere = (choice: FeatureChoice, option: OptionRow): FeatureChoice | undefined =>
		this.holds(choice, option)
			? undefined
			: this.choices.find((other) => other !== choice && this.holds(other, option));

	/** May this chip be pressed? Something already held can always be put down; a prerequisite is
	 *  a wall in Strict and a note in Free, the split every cap in the builder uses. */
	canToggle = (choice: FeatureChoice, option: OptionRow): boolean =>
		this.holds(choice, option) ||
		!this.host().draft.strict ||
		this.blockOf(choice, option) === null;

	/** Toggle one option. At the cap a click REPLACES the oldest pick (ui.md §10). */
	toggle = (choice: FeatureChoice, option: OptionRow) => {
		// an option that asks is taken one answer at a time (`toggleAnswer`), never bare
		if (option.data.answer || !this.canToggle(choice, option)) return;
		this.write(choice, toggleCapped(choice.picks, option.id, choice.cap));
	};

	/** Take or put down one answered pick. Each answer is its own pick — "Each time you do so,
	 *  choose a different eligible cantrip" — so the same option may be held once per answer, and
	 *  the cap counts every pick. */
	toggleAnswer = (choice: FeatureChoice, option: OptionRow, answer: string) => {
		const pick = writePick({ id: option.id, answer });
		if (!choice.picks.includes(pick) && !this.canToggle(choice, option)) return;
		this.write(choice, toggleCapped(choice.picks, pick, choice.cap));
	};

	private write(choice: FeatureChoice, picks: string[]) {
		const draft = this.host().draft;
		draft.options = { ...draft.options, [choice.feature.id]: picks };
	}
}
