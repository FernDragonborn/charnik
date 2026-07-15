/** 1 → "1st", 2 → "2nd", 11 → "11th" … (spell-level labels, feature lists). */
export const ordinal = (n: number): string =>
	`${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 || Math.floor(n / 10) === 1 ? 0 : n % 10]}`;
