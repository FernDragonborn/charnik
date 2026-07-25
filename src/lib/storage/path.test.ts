import { describe, it, expect } from 'vitest';
import { sandboxRelative } from './path';

describe('sandboxRelative (storage sandbox guard)', () => {
	it('strips leading slashes and `.` segments to a clean root-relative path', () => {
		expect(sandboxRelative('/characters/hero.json')).toBe('characters/hero.json');
		expect(sandboxRelative('./content/./spells.csv')).toBe('content/spells.csv');
		expect(sandboxRelative('a//b')).toBe('a/b');
	});

	it('rejects forward-slash traversal', () => {
		expect(() => sandboxRelative('../secret')).toThrow(/escapes storage root/);
		expect(() => sandboxRelative('content/../../etc/passwd')).toThrow(/escapes storage root/);
	});

	// audit S1: a Windows-style `..\x` used to survive a `/`-only split (one segment `..\x`), so the
	// `..` never matched — normalizing `\`→`/` first is what closes it.
	it('rejects backslash traversal (Windows) — the S1 fix', () => {
		expect(() => sandboxRelative('..\\secret')).toThrow(/escapes storage root/);
		expect(() => sandboxRelative('content\\..\\..\\secret')).toThrow(/escapes storage root/);
		expect(() => sandboxRelative('a\\..\\..\\b')).toThrow(/escapes storage root/);
	});

	it('normalizes mixed separators without escaping', () => {
		expect(sandboxRelative('characters\\hero\\photo.png')).toBe('characters/hero/photo.png');
	});
});
