/** A damaged pack file arriving over a translated one: the bytes land, and the translations are kept
 *  aside and counted. */
import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { beginCarryRun, keepLocalTranslations, orphanedIn } from './translation-carry';

const PATH = 'content/srd-2024/spells_srd.csv';
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('a pack file that arrives malformed, over one that holds translations', () => {
	it('sets the translated file aside before it is replaced, and counts what it could not carry', async () => {
		const storage = new MemoryStorage();
		await storage.write(
			PATH,
			'id,name_en,name_uk\nfireball,Fireball,Вогняна куля\nlight,Light,Світло\n',
		);
		// an unclosed quote: the rows after it are swallowed into one cell
		const incoming = 'id,name_en,name_uk\nfireball,"Fireball,\nlight,Light,\n';

		const run = beginCarryRun(storage);
		const written = await keepLocalTranslations(run, PATH, bytes(incoming));

		// the file lands as the bytes it arrived as — that half is deliberate…
		expect(new TextDecoder().decode(written)).toBe(incoming);
		// …but two translated rows went with the file it replaces, and nothing keeps them or says so
		expect(await storage.exists(`${run.backupDir}/srd-2024/spells_srd.csv`)).toBe(true);
		expect(orphanedIn(run)).toBe(2);
	});
});
