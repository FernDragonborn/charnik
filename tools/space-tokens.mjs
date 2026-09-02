/*
 * Move the padding / margin / gap / border-radius literals in a set of files onto the spacing
 * tokens. Only those four properties — a 1px border, a min-width or a font-size is not spacing, and
 * blanket-replacing every px is how a sweep like this breaks a layout.
 *
 * `node tools/space-tokens.mjs <files…>`. The builder is done; `src/routes/combat/**` and
 * `src/lib/components/**` are the two that remain, and each wants its own look-at-it pass after.
 *
 * Values snap to the NEAREST token, so nothing moves by more than a pixel; the half-steps exist
 * because the values themselves are what the scale was derived from.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const TOKEN_FOR = new Map([
	[3, 'var(--space-1)'],
	[4, 'var(--space-1)'],
	[5, 'var(--space-1)'],
	[6, 'var(--space-1-5)'],
	[7, 'var(--space-1-5)'],
	[8, 'var(--space-2)'],
	[9, 'var(--space-2)'],
	[10, 'var(--space-2-5)'],
	[11, 'var(--space-2-5)'],
	[12, 'var(--space-3)'],
	[13, 'var(--space-3)'],
	[16, 'var(--space-4)'],
	[24, 'var(--space-5)'],
	[32, 'var(--space-6)'],
]);
const RADIUS_FOR = new Map([
	[5, 'var(--radius-sm)'],
	[6, 'var(--radius-sm)'],
	[8, 'var(--radius)'],
	[9, 'var(--radius)'],
	[11, 'var(--radius-md)'],
	[14, 'var(--radius-lg)'],
]);
// the logical sides too — the repo's box sides are `inline`/`block`, so a physical-only pattern
// walks straight past most of what is left
const SPACING =
	/^(\s*)(padding|margin|gap|row-gap|column-gap|inset)(-(top|bottom|left|right|inline|block)(-(start|end))?)?:\s*([^;]+);/;
const RADIUS = /^(\s*)(border-radius):\s*([^;]+);/;

/** A negative offset is spacing too (a row bleeding into its card's padding), and `-var(…)` is not a
 *  value — it parses as nothing and the whole declaration is dropped, silently. */
const swap = (line, table) =>
	line.replace(/(-?)(\d+)px/g, (px, sign, n) => {
		const token = table.get(Number(n));
		if (!token) return px;
		return sign ? `calc(-1 * ${token})` : token;
	});

let changed = 0;
for (const file of process.argv.slice(2)) {
	const out = readFileSync(file, 'utf8')
		.split('\n')
		.map((line) => {
			if (RADIUS.test(line)) return swap(line, RADIUS_FOR);
			return SPACING.test(line) ? swap(line, TOKEN_FOR) : line;
		})
		.join('\n');
	const before = readFileSync(file, 'utf8');
	if (out !== before) {
		writeFileSync(file, out);
		changed++;
	}
}
console.log(`rewrote ${changed} file(s)`);
