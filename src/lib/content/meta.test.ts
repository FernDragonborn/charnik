import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseContentDirectives, checkFileMeta, isHashDrift } from './meta';

const fixture = (rel: string) =>
	readFileSync(
		fileURLToPath(new URL(`../../../tests/fixtures/content/${rel}`, import.meta.url)),
		'utf8'
	);

describe('content meta directives', () => {
	it('parses a full directive header and strips it off the body', () => {
		const csv =
			'#content-type: spell\n#content-source: SRD 5.2.1\n#content-license: CC-BY-4.0\nid,name_en\nx,X\n';
		const { directives, body } = parseContentDirectives(csv);
		expect(directives.get('source')).toBe('SRD 5.2.1');
		expect(directives.get('license')).toBe('CC-BY-4.0');
		expect(body).toBe('id,name_en\nx,X\n'); // directive block gone, CSV intact
	});

	it('normalizes a legacy kebab directive key to snake (backward-compat read)', () => {
		const csv = '#content-updated-at: 2026-07-16\n#content-author-url: https://x.y\nid\nrow\n';
		const { directives } = parseContentDirectives(csv);
		expect(directives.get('updated_at')).toBe('2026-07-16'); // `updated-at` → `updated_at`
		expect(directives.get('author_url')).toBe('https://x.y');
	});

	it('tolerates a BOM and blank spacer lines in the header', () => {
		const csv = '﻿#content-source: Homebrew\n\n#content-schema: 2\nid\nrow\n';
		const { directives, body } = parseContentDirectives(csv);
		expect(directives.get('source')).toBe('Homebrew');
		expect(directives.get('schema')).toBe('2');
		expect(body).toBe('id\nrow\n');
	});

	it('flags the underfilled fixture: source+license (human) and id/hash/updated-at/schema (auto)', () => {
		const csv = fixture('homebrew-underfilled/spells_homebrew.csv');
		const { directives } = parseContentDirectives(csv);
		expect(directives.size).toBe(0); // fixture carries NO directives at all
		const issue = checkFileMeta('spells_homebrew.csv', directives);
		expect(issue).not.toBeNull();
		expect(issue!.missingHuman).toEqual(['source', 'license']);
		expect(issue!.missingAuto).toEqual(['id', 'hash', 'updated_at', 'schema']);
		expect(issue!.missingOptional).toEqual(['systems', 'url', 'author', 'author_url']);
		expect(issue!.values).toEqual({}); // fixture declares nothing → form starts empty
	});

	it('returns null when both required human keys are present (missing machine keys alone never open it)', () => {
		// only source+license matter for opening the modal; id/hash/updated-at/schema are auto-filled
		const csv = '#content-source: X\n#content-license: CC-BY-4.0\nid\nr\n';
		expect(checkFileMeta('f.csv', parseContentDirectives(csv).directives)).toBeNull();
	});

	it('does NOT open for a present-but-stale hash (drift is a separate pop-up)', () => {
		const csv =
			'#content-source: X\n#content-license: CC-BY-4.0\n#content-hash: xxh64:stale\nid\nr\n';
		expect(checkFileMeta('f.csv', parseContentDirectives(csv).directives)).toBeNull();
	});

	it('passes back already-declared values so the form pre-fills them', () => {
		// source present, license MISSING → opens; the form should show source + url + systems pre-filled
		const csv =
			'#content-source: My Homebrew\n#content-url: https://example.test\n#content-systems: 5e\nid\nr\n';
		const issue = checkFileMeta('f.csv', parseContentDirectives(csv).directives)!;
		expect(issue).not.toBeNull();
		expect(issue.missingHuman).toEqual(['license']); // only the license still needs a value
		expect(issue.values).toEqual({
			source: 'My Homebrew',
			url: 'https://example.test',
			systems: '5e'
		});
	});
});

describe('isHashDrift', () => {
	it('is true only when a recorded hash differs from the recomputed one', () => {
		expect(isHashDrift('xxh64:aaa', 'xxh64:bbb')).toBe(true); // stale
		expect(isHashDrift('xxh64:aaa', 'xxh64:aaa')).toBe(false); // matches
	});
	it('treats an absent recorded hash as missing (auto-fill), NOT drift', () => {
		expect(isHashDrift(undefined, 'xxh64:bbb')).toBe(false);
	});
});
