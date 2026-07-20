/*
 * "Did you mean?" for a token typed against a CLOSED vocabulary (AUDIT PLG-9). When an effect token
 * fails a bounded set — an unknown target key, a typo'd condition/skill id — the error appends the
 * nearest valid candidate(s) so a dead-end becomes a one-glance fix. NEVER call on free text (args,
 * guard expressions); only on finite, known vocabularies.
 */
import { distance } from 'fastest-levenshtein';

/**
 * Length-RELATIVE edit-distance cap. A fixed absolute is both too loose for short ids (`hp`→`ac` is
 * distance 2 — a garbage suggestion) and too strict for long ones (`invstigaton`→`investigation` is
 * 3 edits — missed). Tiers on the longer of the two strings: ≤1 for ≤4 chars, ≤2 for 5–8, ≤3 for 9+.
 */
const maxDistanceFor = (len: number): number => (len <= 4 ? 1 : len <= 8 ? 2 : 3);

/**
 * The nearest 1–2 candidates to `input` within the length-relative cap, CLOSEST first. Empty when
 * nothing is close enough (better silent than a misleading guess) or when `input` is an exact match
 * (no typo). `fastest-levenshtein` is plain Levenshtein — a transposition costs 2, but the length
 * tiers still surface it (`flta_bonus`→`flat_bonus`, len 10, distance 2 ≤ 3).
 */
export function suggestClosest(input: string, candidates: Iterable<string>, limit = 2): string[] {
	const scored: { candidate: string; dist: number }[] = [];
	for (const candidate of candidates) {
		const dist = distance(input, candidate);
		if (dist === 0) return []; // exact — not a typo
		if (dist <= maxDistanceFor(Math.max(input.length, candidate.length)))
			scored.push({ candidate, dist });
	}
	scored.sort((a, b) => a.dist - b.dist || a.candidate.localeCompare(b.candidate));
	return scored.slice(0, limit).map((s) => s.candidate);
}

/** The suffix to append to an error reason: ` — did you mean "x" or "y"?`, or '' if nothing is
 *  close. Keeps the "surface, never drop" contract readable. */
export function didYouMean(input: string, candidates: Iterable<string>): string {
	const hits = suggestClosest(input, candidates);
	if (!hits.length) return '';
	return ` — did you mean ${hits.map((h) => `"${h}"`).join(' or ')}?`;
}
