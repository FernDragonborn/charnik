/*
 * What the derive says when one token does not work — the catalog keys and the issue shape
 * content-health lists beside the loader's.
 */
import type { SaidText } from '$lib/util/say';

/** Catalog keys for the derive-time issues — the ONE owner, like `NOTE_KEY` for the engine's rule
 *  notes, so the producers below and the message catalogs never drift on a bare string. */
export const ISSUE_KEY = {
	unknownTarget: 'effectIssue.unknownTarget',
	unknownTargetSuggested: 'effectIssue.unknownTargetSuggested',
	unknownCondition: 'effectIssue.unknownCondition',
	unknownConditionSuggested: 'effectIssue.unknownConditionSuggested',
	armorBlocksCasting: 'effectIssue.armorBlocksCasting',
	duplicateClassFeature: 'effectIssue.duplicateClassFeature',
	unreadableOptionEffect: 'effectIssue.unreadableOptionEffect',
	unreadableOptionCondition: 'effectIssue.unreadableOptionCondition',
	unreadableOptionCost: 'effectIssue.unreadableOptionCost',
	unrollableValue: 'effectIssue.unrollableValue',
	unreadableResourceMax: 'effectIssue.unreadableResourceMax',
	unreadableFormValue: 'effectIssue.unreadableFormValue',
	pluginFailed: 'effectIssue.pluginFailed',
	dependencyCycle: 'effectIssue.dependencyCycle',
	misplacedWalkingSpeed: 'effectIssue.misplacedWalkingSpeed',
	attackOnly: 'effectIssue.attackOnly',
	unreadableGuard: 'effectIssue.unreadableGuard',
	rolledAbilityScore: 'effectIssue.rolledAbilityScore',
	unreadableAbilityChange: 'effectIssue.unreadableAbilityChange',
	noPreparedCount: 'effectIssue.noPreparedCount',
} as const;

/** A derive-time problem with one token — the SPEC10 shape ({token, reason} + the carrying source)
 *  content-health merges with loader issues. */
export interface EffectIssue extends SaidText {
	source: string;
	token: string;
	/** What went wrong and what it means for the sheet, in the words of whoever wrote the CSV row, as
	 *  the catalog KEY and its values (`SaidText`) — the derive has no locale and the panel showing it
	 *  is re-read after a language switch. The parser's own phrasing belongs in `detail` (UX-1). */
	key: string;
	/** The technical particulars (the parser's complaint, a plugin's error) — shown demoted, so the
	 *  homebrew author still gets the exact fault the sentence summarizes. */
	detail?: string;
}
