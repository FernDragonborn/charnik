/*
 * Reading one `form` token into what it says about a form (`facts.ts` ▸ `FormRules`), and adding
 * that to what the facts already know. Split from the collector in apply.ts, which only routes the
 * kind here: the words, which of them carry an expression, and the one value that is read exact are
 * this kind's own business.
 */
import { evalExpression, type ExprContext } from './expression-evaluator';
import { addFormStatement, type FormRules, type FormStatement } from './facts';
import { FORM_WORD, type ParsedEffect } from './token-parser';
import type { FormWord } from './token-words';

/** Where a statement came from, and how to say that its value could not be read. */
interface StatementOrigin {
	source: string;
	ctx: ExprContext | undefined;
	unreadable(detail: string): void;
}

/** One `form` statement, added to what is already known of that form. A value that does not
 *  resolve is SURFACED and the statement skipped: an unread limit is not a limit of zero. */
export function collectFormStatement(
	forms: FormRules[],
	p: ParsedEffect,
	origin: StatementOrigin,
): void {
	if (!p.target || !p.form) return;
	const said = formStatement(p.form, origin);
	if (!said) return;
	let rules = forms.find((f) => f.id === p.target);
	if (!rules) {
		rules = {
			id: p.target,
			source: origin.source,
			without: [],
			ownHp: false,
			casts: false,
			onlySenses: false,
			endsWhen: [],
			sheds: [],
			wornOnly: false,
		};
		forms.push(rules);
	}
	addFormStatement(rules, said);
}

/** The words that turn one rule on, and the words whose value joins a list of them. */
const FLAG_OF: Partial<Record<FormWord, 'ownHp' | 'casts' | 'onlySenses' | 'wornOnly'>> = {
	[FORM_WORD.ownHp]: 'ownHp',
	[FORM_WORD.casts]: 'casts',
	[FORM_WORD.onlySenses]: 'onlySenses',
	[FORM_WORD.wornOnly]: 'wornOnly',
};
const LIST_OF: Partial<Record<FormWord, 'without' | 'endsWhen' | 'sheds'>> = {
	[FORM_WORD.without]: 'without',
	[FORM_WORD.endsWhen]: 'endsWhen',
	[FORM_WORD.sheds]: 'sheds',
};

function formStatement(
	{ word, value }: NonNullable<ParsedEffect['form']>,
	{ ctx, unreadable }: StatementOrigin,
): FormStatement | undefined {
	if (word === FORM_WORD.creature) return value ? { creature: value } : undefined;
	const flag = FLAG_OF[word];
	if (flag) return { [flag]: true };
	const list = LIST_OF[word];
	if (list) return value ? { [list]: [value] } : undefined;
	const r = ctx
		? evalExpression(value ?? '', ctx)
		: ({ ok: false, error: 'expression needs a context' } as const);
	if (!r.ok || r.value.type !== 'number' || !Number.isFinite(r.value.value)) {
		unreadable(r.ok ? 'the value is not a number' : r.error);
		return undefined;
	}
	const n = r.value.value;
	// a Challenge Rating is the one value read EXACT — 1/4 is a rating, not zero
	if (word === FORM_WORD.maxCr) return { maxCr: n };
	if (word === FORM_WORD.tempHp) return { tempHp: Math.floor(n) };
	if (word === FORM_WORD.known) return { known: Math.floor(n) };
	return { hours: Math.floor(n) };
}
