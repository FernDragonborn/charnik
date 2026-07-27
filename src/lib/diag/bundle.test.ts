import { describe, it, expect } from 'vitest';
import { newCharacter } from '$lib/character/schema';
import { buildDiagnostics, summarizeCharacter, formatBundle } from './bundle';
import { LogLevel, type LogEntry } from './logger';

/** A character carrying obvious PII markers, to prove none of them reach the bundle. */
function characterWithPii() {
	const c = newCharacter('slug-1', 'Sir Reginald Fluffington III', '5e');
	c.build.notes = 'secret backstory: my email is me@example.com';
	c.build.classes = [
		{ class: 'phb:wizard', level: 3, subclass: 'phb:evocation' },
		{ class: 'phb:fighter', level: 2 }
	];
	c.build.species = 'phb:elf';
	c.build.background = 'phb:sage';
	c.build.feats = ['phb:alert'];
	c.build.photo = 'reginald.png';
	return c;
}

describe('summarizeCharacter', () => {
	it('keeps build identity (id/system/classes/level/counts)', () => {
		const s = summarizeCharacter(characterWithPii());
		expect(s.id).toBe('slug-1');
		expect(s.system).toBe('5e');
		expect(s.totalLevel).toBe(5);
		expect(s.classes).toEqual([
			{ class: 'phb:wizard', level: 3, subclass: 'phb:evocation' },
			{ class: 'phb:fighter', level: 2 }
		]);
		expect(s.counts).toEqual({ feats: 1, inventory: 0, spells: 0 });
	});

	it('NEVER leaks name, notes, or photo (redaction invariant)', () => {
		const serialized = JSON.stringify(summarizeCharacter(characterWithPii()));
		expect(serialized).not.toContain('Reginald');
		expect(serialized).not.toContain('secret backstory');
		expect(serialized).not.toContain('example.com');
		expect(serialized).not.toContain('reginald.png');
	});
});

describe('buildDiagnostics', () => {
	const log: LogEntry[] = [
		{ ts: 0, level: LogLevel.Info, msg: 'content loaded', ctx: { rows: 42 } },
		{ ts: 1000, level: LogLevel.Error, msg: 'uncaught error', ctx: { stack: 'x' } }
	];

	it('assembles the full snapshot, character redacted', () => {
		const b = buildDiagnostics({
			appVersion: '0.4.0',
			platform: 'web',
			activeSystem: '5e',
			activeLocale: 'en',
			character: characterWithPii(),
			logTail: log,
			contentIssues: { issues: 2, metaIssues: 0, driftItems: 1 }
		});
		expect(b.appVersion).toBe('0.4.0');
		expect(b.character?.totalLevel).toBe(5);
		expect(b.contentIssues).toEqual({ issues: 2, metaIssues: 0, driftItems: 1 });
		expect(b.log).toHaveLength(2);
		expect(JSON.stringify(b)).not.toContain('Reginald');
	});

	it('handles no active character', () => {
		const b = buildDiagnostics({
			appVersion: '0.4.0',
			platform: 'headless',
			activeSystem: '5.5e',
			activeLocale: 'uk',
			character: null,
			logTail: []
		});
		expect(b.character).toBeNull();
		expect(b.log).toEqual([]);
	});

	it('formatBundle wraps as a fenced json block', () => {
		const out = formatBundle(
			buildDiagnostics({
				appVersion: '0.4.0',
				platform: 'web',
				activeSystem: '5e',
				activeLocale: 'en',
				character: null,
				logTail: []
			})
		);
		expect(out.startsWith('```json\n')).toBe(true);
		expect(out.endsWith('\n```')).toBe(true);
	});
});
