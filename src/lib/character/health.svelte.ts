/*
 * Per-character derive-time health — the SPEC10 bridge: `deriveSheet` returns `deriveIssues`
 * (malformed L2 guards/expressions for THIS build), and the content-health panel merges them with
 * the loader's issues. The derive core is pure and can't publish to a store itself, so the view
 * that derives the OPEN character (the combat page) publishes here.
 */
import type { EffectIssue } from '$lib/effects/token-parser';

class DeriveHealth {
	/** Display name of the character the issues belong to ('' = none published). */
	characterName = $state('');
	issues = $state<EffectIssue[]>([]);

	set(characterName: string, issues: EffectIssue[]): void {
		this.characterName = characterName;
		this.issues = issues;
	}
	clear(): void {
		this.characterName = '';
		this.issues = [];
	}
}

export const deriveHealth = new DeriveHealth();
