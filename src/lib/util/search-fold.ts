/** Every character a keyboard, a font, or a translator types where an apostrophe is meant: the ASCII
 *  one, typographic quotes, the Ukrainian modifier letter `ʼ`, primes, the backtick and acute. */
const APOSTROPHE_LIKE = /[`´ʹʻʼʽˈ‘’‛′＇ꞌ]/g;

/**
 * A string as search compares it: lower-cased, with every apostrophe-like mark read as `'`, so
 * «м'ята» finds «мʼята» and "Tasha’s" finds "Tasha's". One character in, one character out, so an
 * index found in the folded string is the same index in the original.
 */
export const foldForSearch = (text: string): string =>
	text.replace(/[^]/gu, lowerKeepingLength).replace(APOSTROPHE_LIKE, "'");

/** A character lower-cased without growing: `İ` lower-cases to `i` plus a combining dot, which
 *  would shift every highlight after it. The base letter is what a search for `i` means. */
function lowerKeepingLength(char: string): string {
	const lower = char.toLowerCase();
	return lower.length === char.length ? lower : lower.slice(0, char.length);
}
