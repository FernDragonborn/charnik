/*
 * The one CSV body parse, and what it lost.
 *
 * Papa recovers from a malformed file instead of failing: an unclosed quote swallows every row after
 * it into one cell, cells past the header land in `__parsed_extra`, a second column with the same
 * header is renamed. Each is data the reader no longer sees — so the loader says so, and a writer
 * refuses to write the damaged parse back over the file.
 */
import Papa from 'papaparse';

export type CsvRow = Record<string, string>;

/** One thing a parse lost: Papa's code, the data row it is on (1-based) when it has one. */
export interface CsvDamage {
	code: string;
	row?: number;
	detail: string;
}

/** The parse errors that lose data. `TooFewFields` only leaves cells empty, and
 *  `UndetectableDelimiter` is what a one-column file says. */
const DAMAGING_CODES: ReadonlySet<string> = new Set([
	'MissingQuotes',
	'InvalidQuotes',
	'TooManyFields',
]);

export interface CsvTable {
	fields: string[];
	rows: CsvRow[];
	damage: CsvDamage[];
}

export function parseCsvTable(body: string): CsvTable {
	const parsed = Papa.parse<CsvRow>(body, { header: true, skipEmptyLines: true });
	const damage: CsvDamage[] = parsed.errors
		.filter((error) => DAMAGING_CODES.has(error.code))
		.map((error) => ({
			code: error.code,
			...(error.row === undefined ? {} : { row: error.row + 1 }),
			detail: error.message,
		}));
	for (const [renamed, original] of Object.entries(parsed.meta.renamedHeaders ?? {}))
		damage.push({
			code: 'DuplicateHeader',
			detail: `“${original}” twice (the second read as “${renamed}”)`,
		});
	return { fields: [...(parsed.meta.fields ?? [])], rows: parsed.data, damage };
}

export const describeDamage = (damage: CsvDamage[]): string =>
	damage.map((d) => (d.row === undefined ? d.detail : `row ${d.row}: ${d.detail}`)).join('; ');

/** A write refused because the file did not parse whole: writing the parse back would make the loss
 *  permanent. */
export class DamagedCsvError extends Error {
	constructor(
		readonly path: string,
		readonly damage: CsvDamage[],
	) {
		super(
			`${path} is not valid CSV (${describeDamage(damage)}) — fix the file before saving into it`,
		);
		this.name = 'DamagedCsvError';
	}
}

/** The table, or a refusal when writing it back would lose what the parse lost. */
export function parseCsvForRewrite(path: string, body: string): CsvTable {
	const table = parseCsvTable(body);
	if (table.damage.length) throw new DamagedCsvError(path, table.damage);
	return table;
}
