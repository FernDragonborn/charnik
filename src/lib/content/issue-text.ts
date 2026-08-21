/*
 * What a content problem SAYS to the person who owns the file (UX-1).
 *
 * The loader decides that something is wrong; this decides how to say it. Every entry answers the
 * same three things in the reader's words — what happened, what it means for their sheet, what to
 * change — and puts the exact token/column/id in `detail`, which the panel renders demoted rather
 * than dropped (the same panel is the homebrew author's debugger).
 *
 * They live together, away from the parsing, for two reasons: the loader stays about loading, and
 * when this copy is localized there is one file to hand a translator rather than a dozen string
 * literals wedged between `push()` calls.
 */
import { contentTypeLabel } from '../util/format';
import { languageName } from '../i18n/languages';
import { didYouMean } from '../util/suggest';

/** The said half of a content issue: the sentence + the particulars under it. */
export interface IssueText {
	message: string;
	detail?: string;
}

export const issueText = {
	/** `#content-type:` names a type this build has never heard of → the whole file is skipped. */
	unknownDeclaredType: (declared: string, known: Iterable<string>): IssueText => ({
		message: `This file says it holds a kind of content Charnik doesn’t know, so none of its rows were loaded. Correct the type on its first line${didYouMean(declared, known) || '.'}`,
		detail: `#content-type: ${declared}`,
	}),

	/** No directive and a filename that matches no type — nothing to guess from. */
	unknownFileType: (): IssueText => ({
		message:
			'Charnik can’t tell what this file holds, so it was skipped. Either name it after the kind of content it has (spells_mine.csv, feats_mine.csv) or add a first line saying so: #content-type: spell',
	}),

	/** Over the read cap. Almost always a backup/export that wandered into a content folder. */
	oversizedFile: (bytes: number, capBytes: number): IssueText => ({
		message: `This file is bigger than the ${capBytes / (1024 * 1024)} MB Charnik reads for one content file, so it was skipped. A content CSV is normally far smaller than that — check it isn’t a backup, an export, or a damaged file. If it really is content, split it into several files; every file in the folder is loaded.`,
		detail: `${(bytes / (1024 * 1024)).toFixed(1)} MB`,
	}),

	/** A row failed its type's schema. Name the COLUMNS to go fix; the validator's own wording
	 *  ("expected number, received nan") is the author's detail, not the sentence. */
	badRow: (columns: string[], type: string, complaints: string): IssueText => ({
		message: `This row was skipped because ${
			columns.length
				? `the column${columns.length > 1 ? 's' : ''} ${columns.map((c) => `"${c}"`).join(', ')}`
				: 'one of its columns'
		} holds something a ${contentTypeLabel(type)} row can’t use. Correct the cell and save the file — the rest of the file loaded normally.`,
		detail: complaints,
	}),

	/** A `name_*`/`text_*` header whose language part isn’t a language code. */
	malformedLocaleColumn: (column: string): IssueText => ({
		message:
			'This column looks like a translation, but Charnik can’t read a language code out of it, so the column is ignored. Translation columns are written name_<code> or text_<code> — name_uk, text_de.',
		detail: `column "${column}"`,
	}),

	/** A file written against another content-schema version. The direction changes both what
	 *  happened and what to do about it, so it is read off the versions, never off the thrown text. */
	schemaMismatch: (declared: number, supported: number, error: string): IssueText => ({
		message:
			declared > supported
				? 'This file was written by a newer version of Charnik than the one you are running. Its rows were loaded as they are, so anything the newer version added is ignored — update Charnik to read the file fully.'
				: 'This file uses an older layout that Charnik has no way to bring forward, so its rows were loaded exactly as written. If entries from it look wrong, open one in the app and save it again.',
		detail: `#content-schema: ${declared}, this build reads ${supported} · ${error}`,
	}),

	/** Some prose translated, some not — the gap falls back to English (LOC-CHECK). */
	partialTranslation: (locale: string, missingColumns: string[]): IssueText => ({
		message: `Half-translated into ${languageName(locale)} — the parts that are missing show in English until you fill them in (Compendium ▸ Translate).`,
		detail: `empty columns: ${missingColumns.join(', ')}`,
	}),

	/** A `spell_lists` row pointing at a class/spell id that no row in its edition has. */
	unresolvedJoin: (kind: string, id: string, candidates: Iterable<string>): IssueText => ({
		message: `This row puts a spell on a class’s list, but no ${kind} in this edition has that id — so the row does nothing${
			didYouMean(id, candidates) ||
			`. Check the id for a typo, or whether the row’s "systems" column names the edition that ${kind} is in.`
		}`,
		detail: `${kind}_id "${id}"`,
	}),

	/** The same `source:id` twice — the second copy is inert everywhere, so say which one won. */
	duplicateId: (id: string, effectiveId: string, keptIn: string): IssueText => ({
		message: `Two entries share the id "${id}" under the same source, so only the first one is used and this one is ignored everywhere in the app. Give one of them a different id, or delete the copy.`,
		detail: `"${effectiveId}" · the copy in use is in ${keptIn}`,
	}),
};
