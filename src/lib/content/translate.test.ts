import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { loadContent } from './loader';
import { saveTranslation } from './translate';
import { hashBody } from './hash';
import { stampDirectives, type MetaKey } from './meta';

const HEAD =
	'id,systems,source,name_en,name_uk,text_en,material,level,school,casting_time,range,components,duration,concentration,ritual';
const line = (id: string, name: string) =>
	`${id},5.5e,SRD 5.2.1,${name},,A streak,guano,3,evocation,Action,150 feet,V,Instantaneous,false,false`;

/** Seed a spells file WITH a correct #content-hash (so the loader sees no drift until we edit). */
async function seed(s: MemoryStorage, rows: string[]): Promise<void> {
	const body = [HEAD, ...rows].join('\n');
	const dir = new Map<MetaKey, string>([
		['source', 'SRD 5.2.1'],
		['license', 'CC-BY-4.0'],
		['hash', await hashBody(body)]
	]);
	await s.write('a/spells_srd.csv', stampDirectives(dir, body));
}

describe('saveTranslation', () => {
	it('writes localized prose in place and re-stamps the hash (no drift flagged)', async () => {
		const s = new MemoryStorage();
		await seed(s, [line('fireball', 'Fireball')]);

		const before = await loadContent(s, ['a']);
		expect(before.driftItems).toHaveLength(0);
		const row = before.get('spell:SRD 5.2.1:fireball')!;
		expect(row.data.name_uk).toBeUndefined();

		await saveTranslation(s, row, 'uk', {
			name: 'Вогняна куля',
			text: 'Промінь',
			material: 'гуано'
		});

		const after = await loadContent(s, ['a']);
		expect(after.driftItems).toHaveLength(0); // re-stamped → the app's own edit isn't external drift
		const d = after.get('spell:SRD 5.2.1:fireball')!.data;
		expect(d.name_uk).toBe('Вогняна куля');
		expect(d.text_uk).toBe('Промінь');
		expect(d.material_uk).toBe('гуано'); // brand-new column added to the header
		expect(d.name_en).toBe('Fireball'); // English untouched
	});

	it('preserves sibling rows and throws when the row is not in the file', async () => {
		const s = new MemoryStorage();
		await seed(s, [line('fireball', 'Fireball'), line('shield', 'Shield')]);
		const g = await loadContent(s, ['a']);

		await saveTranslation(s, g.get('spell:SRD 5.2.1:fireball')!, 'uk', { name: 'Вогняна' });

		const g2 = await loadContent(s, ['a']);
		expect(g2.get('spell:SRD 5.2.1:shield')!.data.name_en).toBe('Shield'); // sibling intact
		expect(g2.get('spell:SRD 5.2.1:fireball')!.data.name_uk).toBe('Вогняна');

		await expect(
			saveTranslation(s, { root: 'a', file: 'spells_srd.csv', id: 'ghost' }, 'uk', { name: 'x' })
		).rejects.toThrow();
	});
});
