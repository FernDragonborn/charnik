/*
 * Spacing an effect token must never change what it means.
 *
 * `advantage:attack` and `advantage: attack` are the same rule; so are `min_die:damage:two_handed,
 * melee:3` and its tight form. Before `tightenDelimiters`, only six of the tokens in shipped content
 * survived being spaced — the rest either fell to `unknown` (the mechanic silently stopped applying)
 * or kept a leading space in the target, which then matched no stat key. Both failures are invisible:
 * the row loads, the sheet just quietly misses a number.
 *
 * The corpus is the shipped content itself, so a kind parser added later is covered the day content
 * uses it, without anyone remembering to extend a literal list. The literals below keep the test
 * meaningful when the content repo is not checked out, and pin the two shapes with free-form tails.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import Papa from 'papaparse';
import { parseToken, splitGuard, type ParsedEffect } from './token-parser';
import { contentPacks, packDir } from '../../../tools/content-repo.mjs';
import { hasContentRepo } from '../../test-support/real-content';

/** Every distinct `effects` token in the shipped CSVs. */
function shippedTokens(): string[] {
	const out = new Set<string>();
	for (const pack of contentPacks() as string[])
		for (const file of readdirSync(packDir(pack)).filter((f: string) => f.endsWith('.csv'))) {
			const body = readFileSync(`${packDir(pack)}/${file}`, 'utf8')
				.replace(/^\uFEFF/, '') // written with a BOM (Excel safety) — strip before the #-filter
				.split('\n')
				.filter((line) => !line.startsWith('#'))
				.join('\n');
			for (const row of Papa.parse<Record<string, string>>(body, {
				header: true,
				skipEmptyLines: true,
			}).data)
				for (const token of (row.effects ?? '').split(';')) if (token.trim()) out.add(token.trim());
		}
	return [...out];
}

const LITERALS = [
	'advantage:attack',
	'flat_bonus:damage:fire+1d6',
	'min_die:damage:two_handed,melee:3',
	'grant_resource:bardic_inspiration:max(1,cha_mod):long',
	'note:Cursed — you will not part with the axe, and you must attack the nearest creature',
	'plugin:my-pack:on-hit:whatever it wants, verbatim',
];

/** `raw` deliberately keeps the author's own text (it is what an inert note shows), so it is the one
 *  field a spaced token is expected to differ in. */
const meaning = (token: string): Omit<ParsedEffect, 'raw'> => {
	const { raw: _raw, ...rest } = parseToken(splitGuard(token).token);
	return rest;
};

/** What a CSV formatter would emit: one space after the kind's colon. Safe for every kind, including
 *  the free-text ones — a `note:`'s prose starts after it. */
const spaceAfterKind = (token: string) => token.replace(/^([a-z_]+):/, '$1: ');

/** The hostile case: a space after every structural delimiter. Not applied to free-text bodies,
 *  where a comma belongs to the prose and spacing it would change the text itself. */
const spaceEveryDelimiter = (token: string) => token.replace(/([:,])/g, '$1 ');

const isFreeText = (token: string) => /^(note|plugin):/.test(token);

describe('whitespace in an effect token is formatting, not meaning', () => {
	const corpus = [...LITERALS, ...(hasContentRepo ? shippedTokens() : [])];

	it('has a corpus', () => {
		expect(corpus.length).toBeGreaterThanOrEqual(LITERALS.length);
	});

	it.each(corpus)('a space after the kind changes nothing: %s', (token) => {
		expect(meaning(spaceAfterKind(token))).toEqual(meaning(token));
	});

	it.each(corpus.filter((t) => !isFreeText(t)))(
		'a space after every delimiter changes nothing: %s',
		(token) => {
			expect(meaning(spaceEveryDelimiter(token))).toEqual(meaning(token));
		},
	);
});
