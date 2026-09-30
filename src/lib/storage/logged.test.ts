import { describe, it, expect } from 'vitest';
import { MemoryStorage } from './memory';
import { withWriteLog } from './logged';
import { getLogTail, LogLevel, redactPath } from '$lib/diag/logger';

/** The newest entry the ring holds — every assertion here is about the line a call just left. */
const lastEntry = () => getLogTail(1)[0];

describe('redactPath', () => {
	it('masks the character slug, because the slug is the character NAME', () => {
		expect(redactPath('characters/grog-a3f9/character.json')).toBe('characters/*/character.json');
		expect(redactPath('characters/grog-a3f9/photo.png')).toBe('characters/*/photo.png');
	});

	it('leaves every other subtree readable — a pack or a theme names content, not a person', () => {
		expect(redactPath('content/srd-2024/spells.csv')).toBe('content/srd-2024/spells.csv');
		expect(redactPath('themes/midnight.json')).toBe('themes/midnight.json');
	});
});

describe('withWriteLog', () => {
	it('records each mutation with its size, and the path already redacted', async () => {
		const s = withWriteLog(new MemoryStorage());
		await s.write('characters/grog-a3f9/character.json', '{"id":"grog-a3f9"}');
		expect(lastEntry()).toMatchObject({
			level: LogLevel.Debug,
			ctx: { op: 'write', path: 'characters/*/character.json', chars: 18 },
		});
	});

	it('records a failure as an error and still throws it at the caller', async () => {
		const s = withWriteLog(new MemoryStorage());
		await expect(s.write('../escape.json', 'x')).rejects.toThrow();
		const entry = lastEntry();
		expect(entry?.level).toBe(LogLevel.Error);
		expect(entry?.ctx?.op).toBe('write');
		expect(entry?.ctx?.error).toBeTruthy();
	});

	it('says nothing about a read — a missing file is how half this app asks whether one exists', async () => {
		const s = withWriteLog(new MemoryStorage());
		await s.write('content/srd-2024/spells.csv', 'id\n');
		const before = lastEntry();
		await s.read('content/srd-2024/spells.csv');
		await s.exists('content/nope.csv');
		await s.list('content');
		expect(lastEntry()).toBe(before);
	});
});
