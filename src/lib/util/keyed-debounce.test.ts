import { describe, it, expect, vi, afterEach } from 'vitest';
import { KeyedDebounce } from './keyed-debounce';

afterEach(() => vi.useRealTimers());

describe('KeyedDebounce', () => {
	it('writes once after the wait, the latest under one key', () => {
		vi.useFakeTimers();
		const written: string[] = [];
		const d = new KeyedDebounce(600);
		d.schedule('fireball|uk', () => written.push('a'));
		d.schedule('fireball|uk', () => written.push('ab'));
		vi.advanceTimersByTime(600);
		expect(written).toEqual(['ab']);
	});

	/* audit-oct-27 U8: switching row inside the wait lost the previous row's draft */
	it('moving to another key writes the waiting one at once instead of dropping it', () => {
		vi.useFakeTimers();
		const written: string[] = [];
		const d = new KeyedDebounce(600);
		d.schedule('fireball|uk', () => written.push('fireball'));
		d.settle('shield|uk');
		expect(written).toEqual(['fireball']);
		vi.advanceTimersByTime(600);
		expect(written).toEqual(['fireball']);
	});

	it('drops a waiting write when its own key has nothing to write any more', () => {
		vi.useFakeTimers();
		const written: string[] = [];
		const d = new KeyedDebounce(600);
		d.schedule('fireball|uk', () => written.push('fireball'));
		d.settle('fireball|uk');
		vi.advanceTimersByTime(600);
		expect(written).toEqual([]);
	});
});
