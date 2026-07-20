/** 1 → "1st", 2 → "2nd", 11 → "11th" … (spell-level labels, feature lists). */
export const ordinal = (n: number): string =>
	`${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 || Math.floor(n / 10) === 1 ? 0 : n % 10]}`;

/** "sleight_of_hand" / "animal-handling" → "Sleight Of Hand" / "Animal Handling". Handles BOTH
 *  separators (snake ids AND legacy hyphens) — the one title-caser (AUDIT F1). */
export const titleCase = (s: string): string =>
	s.replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

/** An unknown thrown value → its message string (`e.message` or `String(e)`). The one place this
 *  ubiquitous try/catch pattern lives (AUDIT F6). */
export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** A signed modifier for display: 5 → "+5", −2 → "−2", 0 → "+0" (D&D shows a zero mod as "+0";
 *  uses the real minus glyph). The one modifier-formatter (AUDIT F2). */
export const signed = (n: number): string => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
