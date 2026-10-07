/*
 * The cell merge that carries a translation across a file replacement. What is pinned here is what a
 * translator would lose if it were wrong: a saved cell survives, the source side still wins every
 * cell that is its own, and a file with nothing at stake comes back as the bytes it arrived as.
 */
import { describe, it, expect } from 'vitest';
import Papa from 'papaparse';
import { carryLocaleCells } from './locale-merge';
import { fileHashState, stampWithHash } from './hash';
import { HASH_STATE, parseContentDirectives, type MetaKey } from './meta';
import { LOC_STATUS } from './schemas';

const pack = (body: string, extra: [MetaKey, string][] = []): Promise<string> =>
	stampWithHash(new Map<MetaKey, string>([['source', 'Test'], ...extra]), body).then((text) =>
		// a pack ships LF and no BOM; the app's own writes are the other style
		(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n/g, '\n'),
	);

/** The merged file as rows, keyed by id. */
function rowsOf(text: string): Record<string, Record<string, string>> {
	const { body } = parseContentDirectives(text);
	const parsed = Papa.parse<Record<string, string>>(body, { header: true, skipEmptyLines: true });
	return Object.fromEntries(parsed.data.map((row) => [row['id'] ?? '', row]));
}

const HEAD = 'id,damage,name_en,name_uk,text_en,text_uk';

describe('carryLocaleCells', () => {
	it('keeps a translated cell and takes every source-owned cell from the incoming file', async () => {
		const local = await pack(`${HEAD}\nfireball,8d6,Fireball,Вогняна куля,Boom,Бум`);
		const incoming = await pack(`${HEAD}\nfireball,9d6,Fireball,,Boom,`);

		const merged = await carryLocaleCells(incoming, local);

		expect(rowsOf(merged.text)['fireball']).toMatchObject({
			damage: '9d6', // the source's own column: the incoming file wins
			name_uk: 'Вогняна куля',
			text_uk: 'Бум',
		});
		expect(merged.carried).toEqual(['fireball']);
		expect(merged.outdated).toEqual([]);
		expect(await fileHashState(merged.text)).toBe(HASH_STATE.match);
	});

	it('returns the incoming text itself when there is no translation to carry', async () => {
		const local = await pack(`${HEAD}\nfireball,8d6,Fireball,,Boom,`);
		const incoming = await pack(`${HEAD}\nfireball,9d6,Fireball,,Boom!,`);

		const merged = await carryLocaleCells(incoming, local, { upstream: 'abc' });

		expect(merged.text).toBe(incoming); // byte for byte: its blob SHA is still the remote's
		expect(merged.carried).toEqual([]);
	});

	it('returns the incoming text itself when it already holds the same translation', async () => {
		const row = 'fireball,8d6,Fireball,Вогняна куля,Boom,Бум';
		const merged = await carryLocaleCells(
			await pack(`${HEAD}\n${row}`),
			await pack(`${HEAD}\n${row}`),
		);
		expect(merged.carried).toEqual([]);
		expect(merged.text).toBe(await pack(`${HEAD}\n${row}`));
	});

	it('the local cell wins where both sides are filled, and an empty local cell takes the incoming one', async () => {
		const local = await pack(`${HEAD}\nfireball,8d6,Fireball,Моя назва,Boom,`);
		const incoming = await pack(`${HEAD}\nfireball,8d6,Fireball,Чужа назва,Boom,Чужий текст`);

		const merged = await carryLocaleCells(incoming, local);
		const row = rowsOf(merged.text)['fireball'];

		expect(row?.['name_uk']).toBe('Моя назва');
		expect(row?.['text_uk']).toBe('Чужий текст');
		expect(merged.replaced).toEqual(['fireball']); // said, because somebody's words lost
	});

	it('carries only the locales it was asked for', async () => {
		const local = await pack('id,name_en,name_uk,name_xx\nfireball,Fireball,Вогняна куля,Xx');
		const incoming = await pack('id,name_en,name_uk\nfireball,Fireball,');

		const merged = await carryLocaleCells(incoming, local, { onlyLocales: ['uk'] });

		expect(rowsOf(merged.text)['fireball']).toEqual({
			id: 'fireball',
			name_en: 'Fireball',
			name_uk: 'Вогняна куля',
		});
	});

	it('brings a column the incoming file does not have, on every row', async () => {
		const local = await pack(
			'id,name_en,name_uk,material_uk,loc_status_uk\n' +
				'fireball,Fireball,Вогняна куля,гуано,reviewed\nshield,Shield,,,',
		);
		const incoming = await pack('id,name_en,name_uk\nfireball,Fireball,\nshield,Shield,');

		const rows = rowsOf((await carryLocaleCells(incoming, local)).text);

		expect(rows['fireball']).toMatchObject({ material_uk: 'гуано', loc_status_uk: 'reviewed' });
		expect(rows['shield']).toMatchObject({ material_uk: '', loc_status_uk: '' });
	});

	it('marks a translation OUTDATED when the source prose moved under it', async () => {
		const local = await pack(
			`${HEAD},loc_status_uk\n` +
				'fireball,8d6,Fireball,Вогняна куля,Boom,Бум,reviewed\n' +
				'shield,,Shield,Щит,Block,Блок,reviewed',
		);
		const incoming = await pack(
			`${HEAD}\nfireball,8d6,Fireball,,A bigger boom,\nshield,,Shield,,Block,`,
		);

		const merged = await carryLocaleCells(incoming, local);
		const rows = rowsOf(merged.text);

		expect(merged.outdated).toEqual(['fireball']);
		expect(rows['fireball']?.['loc_status_uk']).toBe(LOC_STATUS.outdated);
		expect(rows['fireball']?.['text_uk']).toBe('Бум'); // marked, never dropped
		expect(rows['shield']?.['loc_status_uk']).toBe(LOC_STATUS.reviewed);
	});

	it('does not read a line-ending difference inside a cell as the source having moved', async () => {
		// the app's own save writes CRLF, inside a multi-line cell too; the pack ships LF
		const appSaved = `${HEAD}\r\nfireball,8d6,Fireball,Вогняна куля,"Line one\r\nline two",Бум`;
		const incoming = await pack(`${HEAD}\nfireball,8d6,Fireball,,"Line one\nline two",`);

		const merged = await carryLocaleCells(incoming, appSaved);

		expect(merged.outdated).toEqual([]);
		expect(merged.carried).toEqual(['fireball']);
	});

	it('reports a translated row the incoming file no longer has', async () => {
		const local = await pack(
			`${HEAD}\nsee_i_nvisibility,,See Invisibility,Бачити невидиме,See,Бачити`,
		);
		const incoming = await pack(`${HEAD}\nsee_invisibility,,See Invisibility,,See,`);

		const merged = await carryLocaleCells(incoming, local);

		expect(merged.orphaned).toEqual(['see_i_nvisibility']);
		expect(merged.text).toBe(incoming);
	});

	it("leaves the file's own language to the incoming side", async () => {
		// a pack authored in Ukrainian: `name_uk` is the source here, `name_en` the translation
		const local = await pack('id,name_uk,name_en\nkulia,Куля,My Ball', [['source_lang', 'uk']]);
		const incoming = await pack('id,name_uk,name_en\nkulia,Вогняна куля,', [['source_lang', 'uk']]);

		const row = rowsOf((await carryLocaleCells(incoming, local)).text)['kulia'];

		expect(row).toMatchObject({ name_uk: 'Вогняна куля', name_en: 'My Ball' });
	});

	it('writes the upstream it was built from into the merged header', async () => {
		const local = await pack(`${HEAD}\nfireball,8d6,Fireball,Вогняна куля,Boom,`);
		const incoming = await pack(`${HEAD}\nfireball,9d6,Fireball,,Boom,`);

		const merged = await carryLocaleCells(incoming, local, { upstream: 'abc123' });
		const header = parseContentDirectives(merged.text).directives;

		expect(header.get('upstream')).toBe('abc123');
		expect(header.get('source')).toBe('Test');
		expect(await fileHashState(merged.text)).toBe(HASH_STATE.match);
	});
});
