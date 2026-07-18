import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { loadContent } from './loader';
import {
	saveTranslation,
	saveLocStatus,
	locStatus,
	translationCoverage,
	COVERAGE
} from './translate';
import { LOC_STATUS } from './schemas';
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

describe('translationCoverage', () => {
	it('none / partial / done by prose presence', () => {
		expect(translationCoverage({}, 'uk')).toBe(COVERAGE.none);
		expect(translationCoverage({ name_uk: 'Вогняна' }, 'uk')).toBe(COVERAGE.partial);
		expect(translationCoverage({ name_uk: 'Вогняна', text_uk: 'Промінь' }, 'uk')).toBe(
			COVERAGE.done
		);
	});
});

describe('locStatus', () => {
	it('the source language is always reviewed (even over a stored value)', () => {
		expect(locStatus({}, 'en', 'en')).toBe(LOC_STATUS.reviewed);
		expect(locStatus({ loc_status_en: 'not_started' }, 'en', 'en')).toBe(LOC_STATUS.reviewed);
	});
	it('an unset column derives from prose: none → not_started, some → started', () => {
		expect(locStatus({}, 'en', 'uk')).toBe(LOC_STATUS.notStarted);
		expect(locStatus({ name_uk: 'Вогняна' }, 'en', 'uk')).toBe(LOC_STATUS.started);
	});
	it('an explicit status wins — machine / reviewed are only ever explicit', () => {
		expect(locStatus({ loc_status_uk: 'machine', name_uk: 'x' }, 'en', 'uk')).toBe(
			LOC_STATUS.machine
		);
		expect(locStatus({ loc_status_uk: 'reviewed' }, 'en', 'uk')).toBe(LOC_STATUS.reviewed);
	});
	it('a junk stored value is not trusted — falls through to the derived default', () => {
		expect(locStatus({ loc_status_uk: 'garbage', text_uk: 'y' }, 'en', 'uk')).toBe(
			LOC_STATUS.started
		);
	});
});

describe('saveLocStatus', () => {
	it('writes loc_status_<loc> in place and re-stamps the hash (no drift flagged)', async () => {
		const s = new MemoryStorage();
		await seed(s, [line('fireball', 'Fireball')]);
		const row = (await loadContent(s, ['a'])).get('spell:SRD 5.2.1:fireball')!;

		await saveLocStatus(s, row, 'uk', LOC_STATUS.reviewed);

		const after = await loadContent(s, ['a']);
		expect(after.driftItems).toHaveLength(0); // re-stamped → the app's own edit isn't external drift
		const d = after.get('spell:SRD 5.2.1:fireball')!.data;
		expect(d.loc_status_uk).toBe('reviewed');
		expect(d.name_en).toBe('Fireball'); // English untouched
	});
	it('throws when the row is not in the file', async () => {
		const s = new MemoryStorage();
		await seed(s, [line('fireball', 'Fireball')]);
		await expect(
			saveLocStatus(
				s,
				{ root: 'a', file: 'spells_srd.csv', id: 'ghost' },
				'uk',
				LOC_STATUS.reviewed
			)
		).rejects.toThrow();
	});
});
