/*
 * Carrying translations across a file replacement, cell by cell.
 *
 * A translation lives IN the content file (`content/translate.ts`), and a content file is replaced
 * whole — by a pack update, by the bundled seed, by a maintainer taking a translator's work into the
 * pack. Whole-file replacement is right for everything the SOURCE owns (a damage die, the English
 * text) and wrong for the cells somebody translated, which the other side has never seen. So the two
 * are merged by row `id`: structure and every source-owned cell from the INCOMING file, every
 * non-empty translation cell from the one being replaced.
 *
 * A line merge cannot do this. One translation save re-serialises the file (its EOL, and a new
 * column on every row), so the two sides differ on every line while agreeing on every cell but one.
 *
 * Pure: text in, text out. The IO around it is `translation-carry.ts`.
 */
import Papa from 'papaparse';
import { stampWithHash } from './hash';
import { isLocStatusColumn, isProseLocaleColumn } from './loader';
import { parseContentDirectives } from './meta';
import { LOC_STATUS, LOC_STATUS_COL_BASE, PROSE_BASES, type ProseBase } from './schemas';

type CsvRow = Record<string, string>;

/** What one merge did, by row id — the breadcrumb a log line and a report are built from. */
export interface CarryReport {
	/** rows that kept at least one translated cell the incoming file did not have */
	carried: string[];
	/** the rows among those where the incoming file had a DIFFERENT translation, which lost */
	replaced: string[];
	/** rows whose SOURCE prose moved under a translation, now marked `outdated` */
	outdated: string[];
	/** translated rows the incoming file no longer has — their translation has nowhere to go */
	orphaned: string[];
}

export interface CarryResult extends CarryReport {
	/** The file to write. The incoming text itself, byte for byte, when nothing was carried. */
	text: string;
}

/** Did the merge find any translation at stake? False means the file can be replaced blindly. */
export const touchedTranslations = (report: CarryReport): boolean =>
	report.carried.length > 0 || report.outdated.length > 0 || report.orphaned.length > 0;

/** A translation's own column: `text_uk` → prose base `text`, locale `uk`; `loc_status_uk` → no base. */
interface OwnedColumn {
	base: ProseBase | null;
	locale: string;
}

/** The translator's columns — every prose base in a locale other than the file's own language, and
 *  that locale's tracked status. Null for a column the source owns. */
function ownedColumn(column: string, sourceLang: string): OwnedColumn | null {
	const base = isProseLocaleColumn(column)
		? (PROSE_BASES.find((b) => column.startsWith(`${b}_`)) ?? null)
		: null;
	if (base === null && !isLocStatusColumn(column)) return null;
	const locale = column.slice((base ?? LOC_STATUS_COL_BASE).length + 1);
	return locale.toLowerCase() === sourceLang ? null : { base, locale };
}

const cell = (row: CsvRow | undefined, column: string): string => row?.[column] ?? '';

/** Prose as it is compared: a file the app saved carries CRLF inside a multi-line cell and a pack
 *  carries LF, and that difference is not the text having moved. */
const comparable = (prose: string): string => prose.replace(/\r\n?/g, '\n').trim();

/** The source-language cell of one prose base, including the legacy bare column (`material`). */
const sourceProse = (row: CsvRow, base: ProseBase, sourceLang: string): string =>
	comparable(cell(row, `${base}_${sourceLang}`) || cell(row, base));

function parseCsv(text: string): { fields: string[]; rows: CsvRow[] } {
	const parsed = Papa.parse<CsvRow>(parseContentDirectives(text).body, {
		header: true,
		skipEmptyLines: true,
	});
	return { fields: [...(parsed.meta.fields ?? [])], rows: parsed.data };
}

/**
 * Merge `local`'s translations into `incoming`.
 *
 * **The local cell wins wherever it is not empty.** That is the guarantee the translate view makes
 * good on — nothing a translator saved is replaced by a file that arrived later — and it holds for
 * one author per locale per data folder. An empty local cell takes whatever the incoming file has.
 *
 * **A translation whose source moved is marked, not dropped.** The merge is the only moment both
 * versions of the source prose are in hand, so a row whose English changed under a translation gets
 * `loc_status_<locale>: outdated` and stays readable until somebody revisits it.
 *
 * `upstream` is the git blob SHA of `incoming`. It is written into the merged file's header as
 * `#content-upstream`, because a merged file never again has the bytes of the file it came from, and
 * the pack diff (`remote/diff.ts`) needs something to compare a tree listing against.
 */
export async function carryLocaleCells(
	incoming: string,
	local: string,
	options: {
		upstream?: string;
		/** Carry these locales and no other. For a `local` file somebody else wrote, where an
		 *  unexpected `name_xx` column would otherwise arrive as a new language. */
		onlyLocales?: readonly string[];
	} = {},
): Promise<CarryResult> {
	const { directives } = parseContentDirectives(incoming);
	const sourceLang = (directives.get('source_lang') ?? 'en').toLowerCase();
	const next = parseCsv(incoming);
	const mine = parseCsv(local);

	const wanted = options.onlyLocales?.map((locale) => locale.toLowerCase());
	const owned = mine.fields.flatMap((column) => {
		const parts = ownedColumn(column, sourceLang);
		return parts && (wanted?.includes(parts.locale.toLowerCase()) ?? true)
			? [{ column, ...parts }]
			: [];
	});
	const report: CarryReport = { carried: [], replaced: [], outdated: [], orphaned: [] };
	const unchanged = { text: incoming, ...report };
	if (owned.length === 0 || !next.fields.includes('id')) return unchanged;

	const fields = [...next.fields];
	const set = (row: CsvRow, column: string, value: string): void => {
		row[column] = value;
		if (!fields.includes(column)) fields.push(column);
	};
	const incomingById = new Map(next.rows.map((row) => [cell(row, 'id'), row]));

	for (const localRow of mine.rows) {
		const id = cell(localRow, 'id');
		const translated = owned.filter(({ column }) => cell(localRow, column) !== '');
		if (translated.length === 0) continue;
		const row = incomingById.get(id);
		if (!row) {
			report.orphaned.push(id);
			continue;
		}
		let kept = false;
		let overrode = false;
		for (const { column } of translated) {
			if (comparable(cell(row, column)) === comparable(cell(localRow, column))) continue;
			overrode ||= cell(row, column) !== '';
			set(row, column, cell(localRow, column));
			kept = true;
		}
		if (kept) report.carried.push(id);
		if (overrode) report.replaced.push(id);

		const stale = new Set(
			translated
				.filter(
					({ base }) =>
						base !== null &&
						sourceProse(row, base, sourceLang) !== sourceProse(localRow, base, sourceLang),
				)
				.map(({ locale }) => locale),
		);
		for (const locale of stale) {
			const status = `${LOC_STATUS_COL_BASE}_${locale}`;
			if (cell(row, status) !== LOC_STATUS.outdated) set(row, status, LOC_STATUS.outdated);
		}
		if (stale.size > 0) report.outdated.push(id);
	}

	if (report.carried.length === 0 && report.outdated.length === 0)
		return { ...unchanged, orphaned: report.orphaned };

	// every row carries every column: a column the merge added exists on the rows it did not touch too
	const data = next.rows.map((row) =>
		Object.fromEntries(fields.map((column) => [column, cell(row, column)])),
	);
	const header = new Map(directives);
	if (options.upstream !== undefined) header.set('upstream', options.upstream);
	const text = await stampWithHash(header, Papa.unparse({ fields, data }, { newline: '\n' }));
	return { text, ...report };
}
