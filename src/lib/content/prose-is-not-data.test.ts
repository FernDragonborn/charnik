/*
 * Prose is never a data source.
 *
 * Every number, die, or type the app relies on comes from a declared column. The mistake this locks
 * out is silent and confident: `text_en.match(/(\d+d\d+)/)` takes the first die in a paragraph — right
 * for the row it was written against, wrong for the next one, and gone the moment someone translates
 * the row or writes the same rule in different words. A missing column stays missing: show nothing
 * and let the author fill it in.
 *
 * Whatever PRODUCES a pack mines prose by necessity — the SRD ships as prose and there is no other
 * source — but that work happens in a sibling repository and lands as a CSV diff a human reads. This
 * repository has no exception to cover.
 *
 * Line-based on purpose: it catches the shape that actually gets written (and copy-pasted), not every
 * conceivable one. A prose read and its regex split across two statements slips through. A tripwire on
 * the cheap path, not a proof of absence.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Reading a prose column, however the row got named: `d.text_en`, `row.data.text`,
 *  `` data[`text_${locale}`] ``. `.text(` is a method (`Response.text()`), not a column. */
const PROSE_READ = /(?:\.|\[\s*[`'"])\s*text(?![a-zA-Z0-9])(?!\s*\()/;

/** Pulling a value OUT of something: a capturing regex, or a coercion to number. Rendering prose
 *  (stripping markdown, escaping) uses neither, which is what keeps the display paths legal. */
const EXTRACTION = /\/[^/\n]*\([^)\n]*\)[^/\n]*\/[gimsuy]*|\b(?:Number|parseInt|parseFloat)\s*\(/;

function sourceFiles(): string[] {
	return readdirSync(srcRoot, { recursive: true, encoding: 'utf8' })
		.filter((p) => /\.(ts|svelte)$/.test(p) && !p.endsWith('.test.ts'))
		.map((p) => resolve(srcRoot, p));
}

describe('prose is not a data source', () => {
	it('there are source files to scan at all', () => {
		expect(sourceFiles().length).toBeGreaterThan(0);
	});

	it('no runtime code extracts a value from a prose column', () => {
		const offenders: string[] = [];
		for (const file of sourceFiles()) {
			readFileSync(file, 'utf8')
				.split('\n')
				.forEach((line, i) => {
					if (PROSE_READ.test(line) && EXTRACTION.test(line))
						offenders.push(`${file.slice(srcRoot.length + 1)}:${i + 1} — ${line.trim()}`);
				});
		}
		expect(offenders).toEqual([]);
	});
});
