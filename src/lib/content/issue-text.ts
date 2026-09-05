/*
 * What a content problem SAYS to the person who owns the file (UX-1).
 *
 * The loader decides that something is wrong; this decides how to say it. Every entry answers the
 * same three things in the reader's words — what happened, what it means for their sheet, what to
 * change — and puts the exact token/column/id in `detail`, which the panel renders demoted rather
 * than dropped (the same panel is the homebrew author's debugger).
 *
 * The sentences themselves are in the message catalogs under `contentIssue.*`, because the loader
 * runs with no locale and the panel is re-read in whichever language the app is switched to. What
 * lives here is the CHOICE: which sentence a fault gets, and the values that go into it. A wording
 * that branches — a suggestion is close enough, a file is newer rather than older — branches into
 * two keys rather than composing half a sentence, so a translator sees each one whole.
 */
import { languageName } from '../i18n/languages';
import { suggestClosest } from '../util/suggest';
import type { SaidText } from '../util/say';

/** The said half of a content issue: which sentence, and the particulars under it. */
export interface IssueText extends SaidText {
	detail?: string;
}

/** `contentIssue.<name>`, so a key is spelled once and reads as one word at the call site. */
const key = (name: string): string => `contentIssue.${name}`;

/** The suggestion values for a mistyped member of a CLOSED vocabulary, or undefined when nothing is
 *  close enough — which is what decides between a message that offers a guess and one that does not. */
const suggestion = (
	input: string,
	candidates: Iterable<string>,
): { options: string[] } | undefined => {
	const options = suggestClosest(input, candidates);
	return options.length ? { options } : undefined;
};

/** The issues a file fixes by being TOLD its content type — no directive and an unrecognised name, or
 *  a directive naming a type this build does not have. Both are answered by writing `#content-type:`,
 *  which is why content health offers the picker on exactly these two and nowhere else. */
export const TYPE_ASSIGNABLE_KEYS: readonly string[] = [
	key('unknownFileType'),
	key('unknownDeclaredType'),
	// the same fault said with a guess attached — the wording branches, the repair does not
	key('unknownDeclaredTypeSuggested'),
];

export const issueText = {
	/** `#content-type:` names a type this build has never heard of → the whole file is skipped. */
	unknownDeclaredType: (declared: string, known: Iterable<string>): IssueText => {
		const near = suggestion(declared, known);
		return {
			key: key(near ? 'unknownDeclaredTypeSuggested' : 'unknownDeclaredType'),
			values: { ...(near ? { options: near } : {}) },
			detail: `#content-type: ${declared}`,
		};
	},

	/** No directive and a filename that matches no type. TWO real causes, not one: a hand-named file,
	 *  and — because content ships from its own repo on its own schedule — a file for a content type
	 *  only a NEWER app knows (`resources_srd.csv` did exactly this to installed builds). */
	unknownFileType: (): IssueText => ({ key: key('unknownFileType') }),

	/** Over the read cap. Almost always a backup/export that wandered into a content folder. */
	oversizedFile: (bytes: number, capBytes: number): IssueText => ({
		key: key('oversizedFile'),
		values: { cap: capBytes / (1024 * 1024) },
		detail: `${(bytes / (1024 * 1024)).toFixed(1)} MB`,
	}),

	/** A row failed its type's schema. Name the COLUMNS to go fix; the validator's own wording
	 *  ("expected number, received nan") is the author's detail, not the sentence. */
	badRow: (columns: string[], type: string, complaints: string): IssueText => ({
		key: key(
			columns.length > 1 ? 'badRowColumns' : columns.length ? 'badRowColumn' : 'badRowAnyColumn',
		),
		values: {
			type: { catalog: 'contentType', id: type },
			...(columns.length ? { columns: columns.map((c) => `“${c}”`).join(', ') } : {}),
		},
		detail: complaints,
	}),

	/** A `name_*`/`text_*` header whose language part isn’t a language code. */
	malformedLocaleColumn: (column: string): IssueText => ({
		key: key('malformedLocaleColumn'),
		detail: `column "${column}"`,
	}),

	/** A file written against another content-schema version. The direction changes both what
	 *  happened and what to do about it, so it is read off the versions, never off the thrown text. */
	schemaMismatch: (declared: number, supported: number, error: string): IssueText => ({
		key: key(declared > supported ? 'schemaNewer' : 'schemaOlder'),
		detail: `#content-schema: ${declared}, this build reads ${supported} · ${error}`,
	}),

	/** Some prose translated, some not — the gap falls back to English (LOC-CHECK). */
	partialTranslation: (locale: string, missingColumns: string[]): IssueText => ({
		key: key('partialTranslation'),
		values: { language: languageName(locale) },
		detail: `empty columns: ${missingColumns.join(', ')}`,
	}),

	/** A `spell_lists` row pointing at a class/spell id that no row in its edition has. */
	unresolvedJoin: (kind: string, id: string, candidates: Iterable<string>): IssueText => {
		const near = suggestion(id, candidates);
		return {
			key: key(near ? 'unresolvedJoinSuggested' : 'unresolvedJoin'),
			values: { kind: { catalog: 'contentType', id: kind }, ...(near ? { options: near } : {}) },
			detail: `${kind}_id "${id}"`,
		};
	},

	/** A class asks its players to choose a subclass, and this edition has none to choose from. */
	noSubclassRows: (level: number): IssueText => ({
		key: key('noSubclassRows'),
		values: { level },
		detail: `subclass_level ${level}, 0 subclasses`,
	}),

	/** A tag whose value has to be a number isn't one. Folding a column into `tags` cost zod's
	 *  per-column validation of it, so this is where that check comes back (docs/plan.md). */
	badTagValue: (tag: string, name: string): IssueText => ({
		key: key('badTagValue'),
		values: { name },
		detail: `tags: ${tag}`,
	}),

	/** `base_item_id` names a row that isn't there — the item silently loses everything it inherits. */
	unresolvedBaseItem: (id: string, candidates: Iterable<string>): IssueText => {
		const near = suggestion(id, candidates);
		return {
			key: key(near ? 'unresolvedBaseItemSuggested' : 'unresolvedBaseItem'),
			values: { ...(near ? { options: near } : {}) },
			detail: `base_item_id "${id}"`,
		};
	},

	/** The same `source:id` twice — the second copy is inert everywhere, so say which one won. */
	duplicateId: (id: string, effectiveId: string, keptIn: string): IssueText => ({
		key: key('duplicateId'),
		values: { id },
		detail: `"${effectiveId}" · the copy in use is in ${keptIn}`,
	}),

	/** A `resource_option` spending a pool nothing grants — the option can never be offered. */
	resourceOptionUngranted: (id: string, granted: Iterable<string>): IssueText => {
		const near = suggestion(id, granted);
		return {
			key: key(near ? 'resourceOptionUngrantedSuggested' : 'resourceOptionUngranted'),
			values: { ...(near ? { options: near } : {}) },
			detail: `resource_id "${id}"`,
		};
	},

	/** A `resource` row naming a pool nothing grants — the name will never be read. */
	resourceUngranted: (id: string, granted: Iterable<string>): IssueText => {
		const near = suggestion(id, granted);
		return {
			key: key(near ? 'resourceUngrantedSuggested' : 'resourceUngranted'),
			values: { ...(near ? { options: near } : {}) },
			detail: `id "${id}"`,
		};
	},
};
