/*
 * The link that opens a GitHub issue already written: the player's words, then the diagnostics.
 * A link has a length GitHub and the browsers will take, so the oldest log lines give way until it
 * fits; the full bundle goes to the clipboard beside it, and the issue says when it was shortened.
 * Pure, so the arithmetic of what fits is a test and not a guess.
 */
import { formatBundle, type DiagnosticsBundle } from './bundle';

/** The longest link handed to the browser. GitHub refuses past about 8 KB of URL. */
export const ISSUE_LINK_MAX = 7500;
/** An issue title is the first words of the description, as GitHub lists it. */
const TITLE_MAX = 80;

export interface IssueWords {
	/** What the player wrote. May be empty: the diagnostics alone are still a report. */
	description: string;
	/** The title when the player wrote nothing. */
	fallbackTitle: string;
	/** Said in the issue when log lines had to go. */
	shortenedNote: string;
}

export interface IssueLink {
	url: string;
	/** Some of the log did not fit in the link — the full bundle is only on the clipboard. */
	shortened: boolean;
}

function issueTitle(words: IssueWords): string {
	const first = words.description.trim().split('\n')[0]?.trim() ?? '';
	if (!first) return words.fallbackTitle;
	return first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX - 1)}…` : first;
}

function linkFor(base: string, title: string, body: string): string {
	return `${base}?${new URLSearchParams({ title, body }).toString()}`;
}

export function issueLink(base: string, words: IssueWords, bundle: DiagnosticsBundle): IssueLink {
	const title = issueTitle(words);
	const said = words.description.trim();
	const bodyWith = (log: DiagnosticsBundle['log'], shortened: boolean): string =>
		[said, shortened ? `_${words.shortenedNote}_` : '', formatBundle({ ...bundle, log })]
			.filter(Boolean)
			.join('\n\n');
	// the newest lines are the ones about the bug, so the oldest give way first
	for (let keep = bundle.log.length; keep >= 0; keep--) {
		const shortened = keep < bundle.log.length;
		const url = linkFor(
			base,
			title,
			bodyWith(bundle.log.slice(bundle.log.length - keep), shortened),
		);
		if (url.length <= ISSUE_LINK_MAX) return { url, shortened };
	}
	// even with no log the words do not fit: they are cut to fit, never dropped, since the clipboard
	// holds the diagnostics but not what the player wrote
	const note = `_${words.shortenedNote}_`;
	const cutTo = (kept: string): string => (kept ? `${kept}…\n\n${note}` : note);
	let kept = said;
	while (kept && linkFor(base, title, cutTo(kept)).length > ISSUE_LINK_MAX)
		kept = kept.slice(0, Math.floor(kept.length * 0.9));
	return { url: linkFor(base, title, cutTo(kept)), shortened: true };
}
