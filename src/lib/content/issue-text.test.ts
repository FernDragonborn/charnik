/*
 * The copy lives in the catalogs; what this file has to get right is the CHOICE — which sentence a
 * fault gets, and the values that go into it — plus the two values that are not literals.
 */
import { describe, it, expect } from 'vitest';
import { issueText, issueMessage } from './issue-text';
import en from '../i18n/locales/en.json';

/** A stand-in catalog over the real English messages, so a key that does not exist shows up here. */
const t = (key: string, o?: { values?: Record<string, string | number>; default?: string }) => {
	const text = key.split('.').reduce<unknown>((node, part) => {
		if (typeof node !== 'object' || node === null) return undefined;
		return (node as Record<string, unknown>)[part];
	}, en);
	if (typeof text !== 'string') return o?.default ?? `MISSING ${key}`;
	return text.replace(/\{(\w+)\}/g, (_, name: string) => String(o?.values?.[name] ?? `{${name}}`));
};

describe('issueText — the sentence a fault gets', () => {
	it('offers a guess only when one is close enough, and says the plain thing otherwise', () => {
		const near = issueText.unresolvedBaseItem('longswrd', ['longsword']);
		expect(issueMessage(near, t)).toContain('Did you mean “longsword”?');
		const far = issueText.unresolvedBaseItem('zzzzzzzz', ['longsword']);
		expect(issueMessage(far, t)).toContain('Check the id for a typo');
	});

	it('reads a content TYPE through its own catalog, not as the raw id', () => {
		const text = issueText.badRow(['systems'], 'spell', 'expected one of "5e"');
		expect(issueMessage(text, t)).toContain('a “Spell” row');
		// the particulars stay verbatim: the panel is the author's debugger too
		expect(text.detail).toBe('expected one of "5e"');
	});

	it('joins two candidates with the reader’s own word for "or"', () => {
		const text = issueText.unknownDeclaredType('spel', ['spell', 'spells']);
		expect(issueMessage(text, t)).toContain('did you mean “spell” or “spells”?');
	});

	it('says the KEY with no translator — a node test never sees half a sentence', () => {
		expect(issueMessage(issueText.unknownFileType())).toBe('contentIssue.unknownFileType');
	});
});
