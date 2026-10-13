/*
 * Assuming and leaving a FORM (a druid's Wild Shape), as actions.
 *
 * The rules a form follows are DATA — the `form` statements of the feature that grants it
 * (`effects/facts.ts` ▸ `FormRules`) — so nothing here knows what a druid is. What ENDS a form
 * without being asked is `./settle`.
 */
import type { Character } from '$lib/character/schema';
import { formStatTokens } from '$lib/character/forms';
import { effectInstanceOf } from './effects';
import { leaveForm } from './form';
import { chain, quietly, type PlayContext, type PlayOutcome } from './outcome';
import { settled } from './settle';
import { spendTurnSlot } from './turn';

/** Rounds in an hour (a round is six seconds) — what turns a form's stated hours into its clock. */
const ROUNDS_PER_HOUR = 600;

/** Which form, which stat block, and what the stat block is called where the effect is shown. */
export interface FormChoice {
	form: string;
	monster: string;
	label: string;
}

/**
 * Assume a form. One already worn is left first — both editions make a new shape replace the old
 * one. What the rules state then happens: a form with hit points of its own takes over the count and
 * the character's wait, Temporary Hit Points are gained (never stacked: the higher stands), and the
 * carrier effect starts the form's clock. A form the sheet does not state, or a ref that is not a
 * stat block, is refused.
 */
export function assumeForm(
	character: Character,
	choice: FormChoice,
	ctx: PlayContext,
): PlayOutcome {
	const rules = ctx.derive(character).facts.forms.find((stated) => stated.id === choice.form);
	const row = ctx.graph.get(choice.monster);
	if (!rules || row?.type !== 'monster') return { ...quietly(character), refused: true };
	const own = leaveForm(character.play);
	const ownHp = rules.ownHp && row.data.hp != null;
	const carrier = effectInstanceOf(
		{
			label: choice.label,
			tokens: formStatTokens(row),
			positive: true,
			ref: choice.monster,
			// 0 is "until removed", which is what a form with no stated length is
			durationRounds: (rules.hours ?? 0) * ROUNDS_PER_HOUR,
		},
		own.round,
	);
	return settled(
		quietly({
			...character,
			play: {
				...own,
				form: {
					id: choice.form,
					monster: choice.monster,
					...(ownHp ? { hpBefore: own.hp.current } : {}),
					worn: [],
				},
				hp: {
					...own.hp,
					current: ownHp ? Number(row.data.hp) : own.hp.current,
					temp: rules.tempHp === undefined ? own.hp.temp : Math.max(own.hp.temp, rules.tempHp),
				},
				effects: [...own.effects, carrier],
			},
		}),
		ctx,
	);
}

/** The form ends: its carrier goes, and hit points that were waiting come back. */
export const leaveFormNow = (character: Character, ctx: PlayContext): PlayOutcome =>
	settled(quietly({ ...character, play: leaveForm(character.play) }), ctx);

/** Leave the form by choice — a Bonus Action in both editions, which the turn has to have. */
export function revertForm(character: Character, ctx: PlayContext): PlayOutcome {
	const form = character.play.form;
	if (!form) return { ...quietly(character), refused: true };
	return chain(spendTurnSlot(character, { slot: 'bonus' }, ctx), (paid) => {
		const left = leaveFormNow(paid, ctx);
		const said = { text: { key: 'combat.notice.formLeft' }, rows: { name: form.monster } };
		return { ...left, notices: [...left.notices, said] };
	});
}

/** Say whether the form wears one carried item. Both editions leave it to the player and the GM
 *  ("you choose whether your equipment falls … merges … or is worn by it"), so nothing is worn
 *  until it is said, and a row the character is not in a form to wear changes nothing. */
export function setFormWorn(
	character: Character,
	{ row, worn }: { row: string; worn: boolean },
	ctx: PlayContext,
): PlayOutcome {
	const form = character.play.form;
	if (!form) return quietly(character);
	const others = form.worn.filter((iid) => iid !== row);
	const next = { ...form, worn: worn ? [...others, row] : others };
	return settled(quietly({ ...character, play: { ...character.play, form: next } }), ctx);
}
