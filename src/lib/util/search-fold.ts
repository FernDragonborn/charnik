/** Every character a keyboard, a font, or a translator types where an apostrophe is meant: the ASCII
 *  one, typographic quotes, the Ukrainian modifier letter `ʼ`, primes, the backtick and acute. */
const APOSTROPHE_LIKE = /[`´ʹʻʼʽˈ‘’‛′＇ꞌ]/g;

/**
 * A string as search compares it: lower-cased, with every apostrophe-like mark read as `'`, so
 * «м'ята» finds «мʼята» and "Tasha’s" finds "Tasha's". One character in, one character out, so an
 * index found in the folded string is the same index in the original.
 */
export const foldForSearch = (text: string): string =>
	text.toLowerCase().replace(APOSTROPHE_LIKE, "'");
