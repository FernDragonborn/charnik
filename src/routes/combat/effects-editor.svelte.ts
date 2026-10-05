/*
 * Effects & conditions on the sheet: the quick-pick catalog, the forms that add one, and the presses
 * that put one on, take it off, or move its round timer. What each press DOES is a pure action in
 * `$lib/play/effects`.
 *
 * "Conditions are merged into the Effects panel" is a design decision, not a coincidence — a
 * condition IS an effect of kind `apply_condition`, so ONE list is the source of truth for what is
 * currently modifying the character, and ONE picker writes into it (docs/internals/content.md ▸
 * CONDEFF). That is why they are one module.
 */
import type { Character, EffectInstance } from '$lib/character/schema';
import {
	addEffect,
	bumpEffectDuration,
	exhaustionLadder,
	removeEffects,
	setAutoCalc,
	setEffectDuration,
	setExhaustion,
	type NewEffect,
} from '$lib/play/effects';
import type { PlayContext, PlayOutcome } from '$lib/play/outcome';
import type { ContentGraph } from '$lib/content/loader';
import {
	addableStateRows,
	conditionRow,
	isConditionRow,
	pickerConditionId,
	isHarmful,
} from '$lib/content/states';
import { localizedName } from '$lib/content/detail';
import { describedProse } from '$lib/content/overrides.svelte';
import { translator } from '$lib/i18n';
import { app } from '$lib/stores/app.svelte';
import { modTargetLabel, type MenuKind } from '$lib/combat/helpers';
import { conditionIdOf } from '$lib/combat/effects-view';

/** One row of the "+" picker. `conditionId` is what makes the two kinds behave differently once
 *  they are in one list: a condition toggles off again, anything else adds another instance. */
export interface StateChoice {
	ref: string | null;
	conditionId: string | null;
	label: string;
	tokens: string[];
	harmful: boolean;
	durationRounds: number | null;
}

/** What the effects editor needs from the sheet around it. */
export interface EffectsHost {
	character: Character | null;
	graph: ContentGraph | null;
	overlay: { kind: MenuKind; top: number; left: number | null; right: number | null } | null;
	/** Carry out a play-state action on the open character. */
	act(action: (character: Character, ctx: PlayContext) => PlayOutcome): void;
}

export class EffectsEditor {
	/** The custom-modifier form: target · sign · amount · label → a `flat_bonus` token the engine
	 *  already applies. It lives here because the button it ends at is `addEffect` — the same dialog's
	 *  other half (`newEffectDuration`) was already on this subsystem, and a form split across two
	 *  objects is two places to look for one panel. */
	customModTarget = $state('ac');
	customModSign = $state<'+' | '-'>('+');
	customModAmount = $state(1);
	customEffectLabel = $state('');
	addCustomModifier = () => {
		const amount = Math.abs(Math.round(this.customModAmount)) || 1;
		const token = `flat_bonus:${this.customModTarget}${this.customModSign}${amount}`;
		const label =
			this.customEffectLabel.trim() ||
			`${this.customModSign}${amount} ${modTargetLabel(this.customModTarget, translator())}`;
		this.addEffect({ label, tokens: [token], positive: this.customModSign === '+' });
		this.customEffectLabel = '';
		this.customModAmount = 1;
		this.host().overlay = null;
	};

	/* Accessor, not an object: a $derived field initialiser runs before a constructor parameter
	   property is assigned (same shape as TurnEconomy / FeatSlots). */
	constructor(private host: () => EffectsHost) {}

	/** The exhaustion ladder height for this character's system (0 = no exhaustion row loaded → the
	 *  stepper hides). */
	exhaustionMax = $derived.by<number>(() => {
		const { graph, character } = this.host();
		return graph && character ? exhaustionLadder(character, graph) : 0;
	});
	/** Flip effects-auto for this character. */
	toggleAutoCalc = () => this.host().act((c, ctx) => setAutoCalc(c, { on: !c.play.autoCalc }, ctx));
	setExhaustion = (level: number): void =>
		this.host().act((c, ctx) => setExhaustion(c, { level }, ctx));
	/** A condition's rules text (English, consistent with the panel's other content labels), looked up
	 *  by id — the G2 info channel: the "attacks against you have advantage", concealed, auto-crit
	 *  parts a single-character sheet can't fold onto any stat still reach the player as reference. */
	conditionText = (id: string): string | null => {
		const graph = this.host().graph;
		const system = this.host().character?.system;
		if (!graph || !system) return null;
		const row = conditionRow(graph, system, id);
		// the READER's language, not `text_en`: a condition that ships a `text_uk` was being opened in
		// English beside a panel that had already switched
		return (row && describedProse(row, app.activeLocale)) || null;
	};

	/**
	 * The prose an effect can OPEN — what the ⓘ shows.
	 *
	 * The playtest read "the (i) does nothing" on a buff, and the ⓘ was simply absent: it rendered
	 * only for a condition, so a spell's buff — the commonest thing on that panel — had no way to say
	 * what the spell does. Three sources, first one that answers: the condition's rules text, the row
	 * that GRANTED it (a spell's own description), then whatever the player typed for a custom one.
	 *
	 * Null is a real answer: a hand-made buff carrying only tokens already shows them as tags, and an
	 * ⓘ that opens the words already on the row is a control that does nothing.
	 */
	effectProse = (e: EffectInstance): string | null => {
		const applied = conditionIdOf(e);
		const rules = applied ? this.conditionText(applied) : null;
		if (rules) return rules;
		const graph = this.host().graph;
		const row = e.source && graph ? graph.get(e.source) : undefined;
		const granted = row ? describedProse(row, app.activeLocale) : '';
		return granted || e.text?.trim() || null;
	};

	/** A condition's own effect tokens (its `effects` column) — what the panel renders as tags for an
	 *  applied condition, since the effect INSTANCE only carries `apply_condition:<id>`. So a Poisoned
	 *  row shows its disadvantage tags + the display-only `note:` mechanics, not a bare "Poisoned". */
	conditionTokens = (id: string): string[] => {
		const graph = this.host().graph;
		const system = this.host().character?.system;
		if (!graph || !system) return [];
		const row = conditionRow(graph, system, id);
		return row?.data.effects ?? [];
	};

	/** The ONE "+" picker: every state this edition can put on the character, conditions and catalog
	 *  entries together, scoped to its system and user-extendable like all content. A condition
	 *  carries `apply_condition:<id>` rather than its own tokens — the resolver reads that id for
	 *  `has_condition`, and the panel shows the row's mechanics off it.
	 *  A row's `duration_rounds` is its default; blank falls back to the menu's duration picker. */
	stateCatalog = $derived.by<StateChoice[]>(() => {
		const graph = this.host().graph;
		const system = this.host().character?.system;
		if (!graph || !system) return [];
		return addableStateRows(graph, system)
			.map((r) => {
				const condition = isConditionRow(r);
				return {
					// B17: carry the catalog ref so an added effect resolves LIVE at derive (fixes
					// propagate), with the baked label/tokens kept as the orphan fallback. A bare
					// condition carries none: its token already names the row the derive looks up.
					ref: condition ? null : r.effectiveId,
					conditionId: pickerConditionId(r),
					label: localizedName(r, app.activeLocale),
					tokens: condition ? [`apply_condition:${r.id}`] : r.data.effects,
					harmful: isHarmful(r),
					durationRounds: r.data.duration_rounds ?? null,
				};
			})
			.sort((a, b) => a.label.localeCompare(b.label, app.activeLocale));
	});

	/**
	 * How a picker row stands on this character: what the picker OWNS, and what is on them anyway.
	 *
	 * The switch may only take away what the picker could have put there. A catalog row owns what
	 * carries its own ref; a condition owns a BARE application of itself, never a spell's carrier that
	 * applies the same condition among its own tokens — that one holds the concentration, and ending
	 * it belongs to the panel where the cost is visible, not to a list that reads as a reference.
	 *
	 * A condition is recognised by the TOKEN it carries rather than by its label, since the label is
	 * content and a translated pack would stop the switch recognising its own condition. Only the
	 * FOREIGN test falls back to the label, where a miss costs a hint rather than a wrong action.
	 */
	presenceOf = (choice: StateChoice): { owned: EffectInstance[]; foreign: EffectInstance[] } => {
		const live = this.host().character?.play.effects ?? [];
		const isOwn = (e: EffectInstance) =>
			choice.conditionId
				? e.effects.length === 1 && conditionIdOf(e) === choice.conditionId
				: e.source === choice.ref;
		const isSame = (e: EffectInstance) =>
			choice.conditionId ? conditionIdOf(e) === choice.conditionId : e.label === choice.label;
		return { owned: live.filter(isOwn), foreign: live.filter((e) => !isOwn(e) && isSame(e)) };
	};
	/**
	 * Every row is a SWITCH, because every row is a state you are in or are not.
	 *
	 * That is not a house preference: the SRD draws exactly one distinction here — a binary state
	 * versus a ladder, and it names the single ladder (Exhaustion) as cumulative in its own text. The
	 * ladder is `max_level > 1` and never reaches this list, so everything that does is binary. A "+"
	 * offering a second instance offered what `dedupeRuntimeEffects` then takes away.
	 *
	 * Off removes EVERY instance, not one: a save written while the "+" existed can hold two, and a
	 * switch that took one away would still read "on" after the click.
	 */
	toggleState = (choice: StateChoice) => {
		const { owned, foreign } = this.presenceOf(choice);
		if (owned.length) {
			this.removeEffects(owned.map((instance) => instance.iid));
			return;
		}
		// held by a spell or an item: the row says so, and a second instance beside it is refused
		if (foreign.length) return;
		this.addEffect({
			label: choice.label,
			tokens: choice.tokens,
			positive: !choice.harmful,
			// the ROW's own clock or none. A blank `duration_rounds` is the row saying "until removed"
			// (cover lasts while you are behind the wall), and it must not be overwritten with a default
			durationRounds: choice.durationRounds ?? 0,
			ref: choice.ref,
		});
	};

	/** Duration (in rounds) applied to the NEXT effect added from the add-effect / custom menus.
	 *  0 = indefinite (lasts until the player removes it). Editable in the add-effect menu. */
	newEffectDuration = $state(10);
	addEffect = (spec: Omit<NewEffect, 'durationRounds'> & { durationRounds?: number }) =>
		this.host().act((c, ctx) =>
			addEffect(c, { ...spec, durationRounds: spec.durationRounds ?? this.newEffectDuration }, ctx),
		);
	private removeEffects = (iids: string[]) =>
		this.host().act((c, ctx) => removeEffects(c, iids, ctx));
	/** Remove an active effect from the panel (the ✕) — and with it the concentration it carried. */
	removeEffect = (iid: string) => this.removeEffects([iid]);
	/** Set an active effect's remaining duration to an exact round count (typed into the panel field):
	 *  rounds from NOW, and 0 / blank → until removed. */
	setEffectDuration = (iid: string, rounds: number) =>
		this.host().act((c, ctx) => setEffectDuration(c, { iid, rounds }, ctx));
	/** Nudge an active effect's REMAINING duration by ±1 round from the panel. */
	bumpEffectDuration = (iid: string, delta: number) =>
		this.host().act((c, ctx) => bumpEffectDuration(c, { iid, delta }, ctx));
}
