import { describe, it, expect, beforeAll } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { loadContent, type ContentGraph } from './loader';
import { makeNameIndex, makeTextIndex, searchContent, plainText } from './search';

const HEAD =
	'id,systems,source,name_en,name_uk,text_en,level,school,casting_time,range,components,duration,concentration,ritual';
const row = (
	id: string,
	name_en: string,
	name_uk: string,
	text_en: string,
	systems: string,
	source: string
) =>
	`${id},${systems},${source},${name_en},${name_uk},"${text_en}",3,evocation,Action,60 feet,V,Instantaneous,false,false`;

async function seed(): Promise<ContentGraph> {
	const s = new MemoryStorage();
	await s.write('a/_pack.json', JSON.stringify({ source: 'SRD 5.2.1', systems: ['5.5e'] }));
	await s.write(
		'a/spells_srd.csv',
		[
			HEAD,
			row(
				'fireball',
				'Fireball',
				'Вогняна куля',
				'A streak blossoms into an explosion of flame.',
				'5.5e',
				'SRD 5.2.1'
			),
			row(
				'shield',
				'Shield',
				'',
				'An invisible barrier of magic force appears.',
				'5.5e',
				'SRD 5.2.1'
			),
			row(
				'healing-word',
				'Healing Word',
				'',
				'A creature regains hit points equal to 2d4.',
				'5.5e',
				'SRD 5.2.1'
			)
		].join('\n')
	);
	await s.write('b/_pack.json', JSON.stringify({ source: 'SRD 5.1', systems: ['5e'] }));
	await s.write(
		'b/spells_srd.csv',
		[HEAD, row('fireball', 'Fireball', '', 'An explosion of flame.', '5e', 'SRD 5.1')].join('\n')
	);
	return loadContent(s, ['a', 'b']);
}

const both = { editions: ['5e', '5.5e'], locale: 'en' };

describe('content search', () => {
	let graph: ContentGraph;
	let name: ReturnType<typeof makeNameIndex>;
	let text: ReturnType<typeof makeTextIndex>;
	beforeAll(async () => {
		graph = await seed();
		name = makeNameIndex(graph);
		text = makeTextIndex(graph, 'en');
	});

	it('plainText strips HTML + markdown markers', () => {
		expect(plainText('<b>Cone</b> _of_ *Cold* #head')).toBe('Cone of Cold head');
	});

	it('finds by name across editions and filters by edition', () => {
		expect(searchContent(name, text, 'fireball', both).length).toBe(2);
		const only = searchContent(name, text, 'fireball', { editions: ['5.5e'], locale: 'en' });
		expect(only.length).toBe(1);
		expect(only[0].systems).toContain('5.5e');
	});

	it('tolerates a typo in the name', () => {
		const r = searchContent(name, text, 'firball', both);
		expect(r.some((x) => x.id === 'fireball')).toBe(true);
	});

	it('matches article text and returns a snippet (name-only match has none)', () => {
		const byText = searchContent(name, text, 'barrier', both); // only in Shield's text
		expect(byText[0]?.id).toBe('shield');
		expect(byText[0].snippet).toMatch(/barrier/i);
		const byName = searchContent(name, text, 'shield', both);
		expect(byName[0].snippet).toBe(''); // matched by name → no snippet
	});

	it('is cross-language on names (Ukrainian query hits name_uk)', () => {
		const r = searchContent(name, text, 'куля', both);
		expect(r.some((x) => x.id === 'fireball')).toBe(true);
	});

	it('ignores queries shorter than 2 chars', () => {
		expect(searchContent(name, text, 'f', both)).toEqual([]);
	});
});
