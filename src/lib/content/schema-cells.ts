/*
 * How a CSV cell becomes a typed value. Every cell arrives as a string, and an empty one means "not
 * provided" — a CSV has no missing keys — so each column kind here is a coercion plus what blank
 * means for it. One unit because `schemas.ts` is built entirely out of these and nothing else is:
 * the per-type schemas say WHICH kind a column is, this file says what a kind does.
 */
import { asText } from '../util/format';
import { z } from 'zod';
import { SYSTEMS } from '../rules/pipeline';

/** Empty / missing cell → undefined (so optional fields fall back, EN i18n, etc.). */
export const blankToUndef = (v: unknown) => (v === '' || v == null ? undefined : v);

/** Split a CSV list cell (comma/semicolon separated) into trimmed, non-empty items. Already-parsed
 *  arrays pass through stringified. The one splitter shared by build/content code. */
export function splitList(v: unknown): string[] {
	if (Array.isArray(v)) return v.map(String);
	if (v == null || v === '') return [];
	return asText(v)
		.split(/[,;]/)
		.map((s) => s.trim())
		.filter(Boolean);
}

export const optStr = z.preprocess(blankToUndef, z.string().optional());
export const reqStr = z.string().min(1);
export const optNum = z.preprocess(blankToUndef, z.coerce.number().optional());
export const optInt = z.preprocess(blankToUndef, z.coerce.number().int().optional());
export const bool = z.preprocess(
	(v) => (typeof v === 'string' ? ['true', '1', 'yes', 'y'].includes(v.toLowerCase()) : !!v),
	z.boolean(),
);

/** A CSV list cell → a validated array: split via the shared `splitList` (trim + drop empties), then
 *  validate with `schema`. `map` transforms each token before validation (Number for a numeric list).
 *  An already-parsed array value passes straight to `schema`. */
export const csvList = <T extends z.ZodTypeAny>(
	schema: T,
	map: (s: string) => unknown = (s) => s,
) => z.preprocess((v) => (typeof v === 'string' ? splitList(v).map(map) : v), schema);

/** A boolean cell that defaults to `d` when the cell is blank/missing (the common flag shape). */
export const boolDefault = (d: boolean) =>
	z.preprocess((v) => (v === '' || v == null ? d : v), bool).default(d);

/** An enum cell that defaults to `d` when the cell is blank/missing — `boolDefault`'s sibling.
 *
 *  A bare `.default()` fires only for a MISSING key, and a CSV has no missing keys: every column of
 *  every row exists, saying "not provided" with an empty cell. So a defaulted enum without this
 *  rejects the blank cell it was given a default for, which is how the authoring form — which fills
 *  every column of a new row with `''` — could not save a row at all. */
export const enumDefault = <V extends string>(schema: z.ZodType<V>, d: V) =>
	z.preprocess((v) => (v === '' || v == null ? d : v), schema).default(d);

/** `id` is a local slug; effective identity is `source:id`, built by the loader. */
export const idField = z
	.string()
	.min(1)
	.regex(/^[a-z0-9][a-z0-9_]*$/, 'id must be a lowercase snake_case slug (a-z 0-9 _)');

/** `systems` = comma list over SYSTEMS, e.g. "5e" | "5.5e" | "5e,5.5e". */
export const systemsField = csvList(z.array(z.enum(SYSTEMS)).min(1));

/** `Array.isArray` narrows an `unknown` to `any[]` — a TS quirk that re-opens the value this parse
 *  boundary exists to close. Kept local: the effects column is the only place we take an array off a
 *  cell that may already have been parsed once. */
const isUnknownArray = (v: unknown): v is unknown[] => Array.isArray(v);

/** A `;`-separated list of effect tokens. The loader NEVER rejects a token (B12): an unknown or
 *  not-yet-understood token (an L2 guard that starts with a condition not a kind, a `plugin:` token,
 *  a future `reroll:`/`min_die:` kind) is kept VERBATIM and degrades to an inert text note when the
 *  engine interprets it (`parseToken` → `unknown`), never a killed row — so vocabulary growth is
 *  additive, not a breaking change for older apps. Classifying/flagging an unknown token is the
 *  effect engine's job (and a downstream content-health pass, which may import `$lib/effects`), NOT
 *  the schema's — the schema deliberately stays independent of the removable engine. */
export const effectsField = z.preprocess((v) => {
	if (v === '' || v == null) return [];
	if (isUnknownArray(v)) return v; // elements stay `unknown`; the schema below says they're strings
	return asText(v)
		.split(';')
		.map((s) => s.trim())
		.filter(Boolean);
}, z.array(z.string()).default([]));
