/*
 * Assuming and leaving a FORM (a druid's Wild Shape) on the play sheet.
 *
 * A form is two things in play-state, the way concentration is: `play.form` says which stat block
 * and which rules, and an ordinary CARRIER effect in `play.effects` — its `source` the same monster
 * ref — carries the stat block's numbers and the form's clock. So the form shows in the Effects panel
 * with its timer, passing time expires it, and its ✕ ends it, all on paths that already exist; what
 * this module owns is the bookkeeping around those two: whose hit points are counted, and putting
 * them back.
 *
 * The rules a form follows are DATA — the `form` statements of the feature that grants it
 * (`effects/facts.ts` ▸ `FormRules`) — so nothing here knows what a druid is.
 */
import { toast } from 'svelte-sonner';
import { t } from '$lib/i18n';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import type { ContentGraph } from '$lib/content/loader';
import { localizedName } from '$lib/content/detail';
import { isRowActive } from '$lib/content/sources.svelte';
import { app } from '$lib/stores/app.svelte';
import type { FormRules } from '$lib/effects/facts';
import { activeForm, formStatTokens, isEligibleForm, type MonsterRow } from '$lib/character/forms';
import type { TurnEconomy } from './turn-economy.svelte';
import type { EffectsEditor } from './effects-editor.svelte';

/** Rounds in an hour (a round is six seconds) — what turns a form's stated hours into its clock. */
const ROUNDS_PER_HOUR = 600;

/** What the form bookkeeping needs from the sheet around it. */
export interface FormHost {
	character: Character | null;
	sheet: CharacterSheet | null;
	graph: ContentGraph | null;
	economy: TurnEconomy;
	effects: EffectsEditor;
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

	/**
	 * Assume a form. A form already worn is left first — both editions make a new shape replace the
	 * old one. What the rules state then happens: a form with hit points of its own takes over the
	 * count and the character's wait, Temporary Hit Points are gained (never stacked: the higher
	 * stands), and the carrier effect starts the form's clock.
	 */
	assume = (formId: string, monster: string): void => {
		const { character, graph } = this.host();
		const rules = this.rulesOf(formId);
		const row = graph?.get(monster);
		if (!character || !rules || row?.type !== 'monster') return;
		this.leave();
		const play = character.play;
		const ownHp = rules.ownHp && row.data.hp != null;
		play.form = { id: formId, monster, ...(ownHp ? { hpBefore: play.hp.current } : {}) };
		if (ownHp) play.hp.current = Number(row.data.hp);
		if (rules.tempHp !== undefined) play.hp.temp = Math.max(play.hp.temp, rules.tempHp);
		this.host().effects.addEffect({
			label: localizedName(row, app.activeLocale),
			tokens: formStatTokens(row),
			positive: true,
			ref: monster,
			// 0 is "until removed", which is what a form with no stated length is
			durationRounds: (rules.hours ?? 0) * ROUNDS_PER_HOUR,
		});
	};

	/** Leave the form by choice — a Bonus Action in both editions, which the turn has to have. */
	revert = (): void => {
		const form = this.current;
		if (!form || !this.host().economy.trySpend('bonus')) return;
		this.leave();
		toast(t('combat.notice.formLeft', { name: form.name }));
	};

	/** The form ends, however it ended: its carrier goes, and hit points that were waiting come back. */
	leave = (): void => {
		const play = this.host().character?.play;
		const form = play?.form;
		if (!play || !form) return;
		play.effects = play.effects.filter((effect) => effect.source !== form.monster);
		if (form.hpBefore !== undefined) play.hp.current = form.hpBefore;
		play.form = null;
	};

	/**
	 * A form whose carrier is gone has ended — the Effects panel's ✕, the clock running out, a rest.
	 * Those paths remove an effect and know nothing of forms, so this is where the rest of the
	 * leaving happens. Reactive and idempotent, like the concentration sync beside it.
	 */
	sync = (): void => {
		const play = this.host().character?.play;
		const form = play?.form;
		if (play && form && !play.effects.some((effect) => effect.source === form.monster))
			this.leave();
	};

	/**
	 * Damage the form's own hit points cannot hold. RAW (SRD 5.1): "if you revert as a result of
	 * dropping to 0 hit points, any excess damage carries over to your normal form." Returns the
	 * excess to apply to the character, or null when the form holds the hit (or has no hit points
	 * of its own to hold it with).
	 */
	overflow = (damage: number): number | null => {
		const play = this.host().character?.play;
		const form = this.current;
		if (!play || form?.hpBefore === undefined || damage < play.hp.current) return null;
		const excess = damage - play.hp.current;
		this.leave();
		toast(t('combat.notice.formBroken', { name: form.name }), {
			description: t('combat.notice.formBrokenBody', { excess }),
		});
		return excess;
	};
}

/** The rules with their limits lifted: only the creature type is kept. */
const lifted = (rules: FormRules): FormRules => ({
	id: rules.id,
	source: rules.source,
	...(rules.creature !== undefined ? { creature: rules.creature } : {}),
	without: [],
	ownHp: rules.ownHp,
	casts: rules.casts,
});
