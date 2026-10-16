import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '$lib/storage/memory';
import { newCharacter, classRow } from './schema';
import { readLog } from './log-repository';
import { LOG_KIND } from './log-kind';
import { levelGains, logLevelGains } from './level-log';

const row = (rowId: string, cls: string, level: number) => classRow({ class: cls, level, rowId });

describe('level gains', () => {
	it('names each class that rose, and a class taken anew', () => {
		const before = [row('a', 'class:x:fighter', 4)];
		const after = [row('a', 'class:x:fighter', 5), row('b', 'class:x:wizard', 1)];
		expect(levelGains(before, after)).toEqual([
			{ classId: 'class:x:fighter', level: 5 },
			{ classId: 'class:x:wizard', level: 1 },
		]);
	});

	it('says nothing for a level kept or lowered', () => {
		const before = [row('a', 'class:x:fighter', 4), row('b', 'class:x:rogue', 3)];
		const after = [row('a', 'class:x:fighter', 4), row('b', 'class:x:rogue', 2)];
		expect(levelGains(before, after)).toEqual([]);
	});
});

describe('a level-up in the log', () => {
	it('writes one level line per class that rose, with the character level it reached', async () => {
		const storage = new MemoryStorage();
		const before = newCharacter('kel', 'Kel', '5.5e');
		before.build.classes = [row('a', 'class:x:fighter', 4)];
		const after = {
			...before,
			build: { ...before.build, classes: [row('a', 'class:x:fighter', 5)] },
		};
		await logLevelGains(storage, before, after, () => 'Fighter');
		const [line] = await readLog(storage, 'kel');
		expect(line?.kind).toBe(LOG_KIND.level);
		expect(line?.roll).toMatchObject({
			labelKey: 'combat.log.levelGained',
			labelValues: { name: 'Fighter', level: 5, total: 5 },
		});
	});
});
