import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '$lib/storage/memory';
import { stampWithHash } from './hash';
import { hasRollback, rollbackPack } from './remote/install';
import { saveTranslation } from './translate';
import {
	listTranslationBackups,
	renameTranslationBackups,
	restoreTranslationBackup,
} from './translation-backups';
import { beginCarryRun, finishCarryRun, keepLocalTranslations } from './translation-carry';

const FILE = 'content/p/spells.csv';
const HEAD = 'id,name_en,name_uk';
const WHEN = new Date(Date.UTC(2026, 0, 3, 4, 5, 6));
const shipped = (body: string): Promise<string> =>
	stampWithHash(new Map([['source', 'Test']]), `${HEAD}\n${body}`);

/** A pack whose one translated row an update re-ids — the case the merge cannot carry. Returns the
 *  file as it was before, which is what the run copied aside. */
async function updatedOverTranslation(s: MemoryStorage): Promise<string> {
	await s.write(FILE, await shipped('fireball,Fireball,'));
	await s.write('content/p/notes.md', 'mine');
	await saveTranslation(s, { root: 'content/p', file: 'spells.csv', id: 'fireball' }, 'uk', {
		name: 'Вогняна куля',
	});
	const before = await s.read(FILE);
	const run = beginCarryRun(s, WHEN);
	const incoming = new TextEncoder().encode(await shipped('fire_ball,Fireball,'));
	await s.writeBytes(FILE, await keepLocalTranslations(run, FILE, incoming));
	await finishCarryRun(run);
	return before;
}

describe('the copies set aside before a translated file is replaced', () => {
	it('are listed by run, with the pack and the files each one holds', async () => {
		const s = new MemoryStorage();
		await updatedOverTranslation(s);
		await s.write('content-backups/not-a-run/p/spells.csv', 'left here by hand');

		expect(await listTranslationBackups(s)).toEqual([
			{
				path: 'content-backups/2026-01-03T04-05-06',
				when: WHEN.getTime(),
				packs: { p: ['spells.csv'] },
			},
		]);
	});

	it('go back through the swap, so the restore is itself undoable', async () => {
		const s = new MemoryStorage();
		const before = await updatedOverTranslation(s);
		const updated = await s.read(FILE);
		const [backup] = await listTranslationBackups(s);

		expect(await restoreTranslationBackup(s, backup?.path ?? '', 'p')).toEqual(['spells.csv']);

		expect(await s.read(FILE)).toBe(before);
		expect(await s.read('content/p/notes.md')).toBe('mine'); // a file the run never copied stays
		expect(await hasRollback(s, 'p')).toBe(true);
		expect(await rollbackPack(s, 'p')).toBe(true);
		expect(await s.read(FILE)).toBe(updated);
		expect(await listTranslationBackups(s)).toHaveLength(1); // the copy is not spent by using it
	});

	it('move nothing for a pack that is not installed', async () => {
		const s = new MemoryStorage();
		await updatedOverTranslation(s);
		const [backup] = await listTranslationBackups(s);
		await s.remove('content/p');

		expect(await restoreTranslationBackup(s, backup?.path ?? '', 'p')).toEqual([]);
		expect(await s.exists('content/p')).toBe(false);
	});

	it('follow a pack to its new folder name', async () => {
		const s = new MemoryStorage();
		await updatedOverTranslation(s);

		await renameTranslationBackups(s, 'p', 'q');

		expect((await listTranslationBackups(s))[0]?.packs).toEqual({ q: ['spells.csv'] });
	});
});
