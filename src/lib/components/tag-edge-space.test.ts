/*
 * A space at the edge of a tag's text is not rendered.
 *
 * Svelte 5 trims whitespace at the start and end of an element's children, so `<span> +{n}</span>`
 * renders "+1" glued to whatever precedes the span — "STR+1", "Weapon2", "38/ 73". The markup reads
 * right and the page does not, which is why it went unseen at seven sites. `&#32;` does not survive
 * either (it is decoded before the trim), and `{' '}` is what `svelte/no-useless-mustaches` autofixes
 * back into the bug. `&nbsp;` survives, and keeps the number on its label's line.
 *
 * Line-based on purpose, like `prose-is-not-data.test.ts`: it catches the one-line shape that gets
 * written, not a tag whose text starts on the next line (that whitespace is formatting, and trimming
 * it is the point of the rule).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const INLINE = 'span|b|strong|em|small|code|a|i|button|label';
/** An inline opening tag whose text starts with a space: `<span class="x"> +{n}`. An attribute value
 *  holding `=>` would end the tag early for this pattern, so a `>` preceded by `=` is not a tag end. */
const LEADING = new RegExp(`<(?:${INLINE})(?:\\s[^>]*[^=])?> [^\\s<]`);
/** Text that ends with a space right before an inline closing tag: `{n} </span>`. */
const TRAILING = new RegExp(`[^\\s>] </(?:${INLINE})>`);

/** HTML and block comments name tags in prose ("a nested <button> is invalid"); blank them, keeping
 *  their newlines so the line numbers still point at the file. */
const COMMENT = /<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g;
const blankComments = (source: string) =>
	source.replace(COMMENT, (comment) => comment.replace(/[^\n]/g, ''));

function svelteFiles(): string[] {
	return readdirSync(srcRoot, { recursive: true, encoding: 'utf8' })
		.filter((p) => p.endsWith('.svelte'))
		.map((p) => resolve(srcRoot, p));
}

describe('a space at the edge of a tag is not written as text', () => {
	it('there are components to scan at all', () => {
		expect(svelteFiles().length).toBeGreaterThan(0);
	});

	it('no inline tag starts or ends its text with a space', () => {
		const offenders: string[] = [];
		for (const file of svelteFiles()) {
			blankComments(readFileSync(file, 'utf8'))
				.split('\n')
				.forEach((line, i) => {
					if (LEADING.test(line) || TRAILING.test(line))
						offenders.push(`${file.slice(srcRoot.length + 1)}:${i + 1} — ${line.trim()}`);
				});
		}
		expect(offenders).toEqual([]);
	});
});
