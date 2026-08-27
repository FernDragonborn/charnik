import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '$lib/storage/memory';
import { loadContent, type ContentGraph } from './loader';
import { parseItemTags, tagInt, armorWeightOf, weaponCategoryOf, ITEM_TAG } from './item-tags';
import { resolveItem, armorCategoryOf } from './resolved-item';

const S = 'Test';

describe('parseItemTags', () => {
	it('reads bare tags and name:value tags, either separator', () => {
		const tags = parseItemTags('martial, melee; versatile:1d10');
		expect([...tags]).toEqual([
			['martial', ''],
			['melee', ''],
			['versatile', '1d10'],
		]);
	});

	/* The same tolerance the effect tokens have: a person editing a CSV in a spreadsheet puts spaces
	   after punctuation, and that must not change what the row means. */
	it('whitespace anywhere is harmless, and case is not significant', () => {
		expect([...parseItemTags('  Mastery : Nick ,  Finesse ')]).toEqual([
			['mastery', 'nick'],
			['finesse', ''],
		]);
	});

	it('a repeated name keeps the last value', () => {
		expect(parseItemTags('ac:11, ac:18').get('ac')).toBe('18');
	});

	it('an empty cell is no tags, not one blank tag', () => {
		expect(parseItemTags('').size).toBe(0);
		expect(parseItemTags(undefined).size).toBe(0);
	});
});

describe('tagInt', () => {
	/* An ABSENT dex cap means "no cap on Dex" (light armour); `dex_cap:0` means "no Dex at all"
	   (heavy). Collapsing the two onto 0 is how light armour would stop adding the Dex modifier. */
	it('absent is null, not zero', () => {
		const light = parseItemTags('armor:light, ac:11');
		expect(tagInt(light, ITEM_TAG.dexCap)).toBeNull();
		expect(tagInt(parseItemTags('dex_cap:0'), ITEM_TAG.dexCap)).toBe(0);
	});

	it('a non-number is null rather than NaN or 0', () => {
		expect(tagInt(parseItemTags('ac:eleven'), ITEM_TAG.ac)).toBeNull();
	});
});

describe('categories off tags', () => {
	it('weapon category, martial winning over simple', () => {
		expect(weaponCategoryOf(parseItemTags('martial, melee'))).toBe('martial');
		expect(weaponCategoryOf(parseItemTags('simple, ranged'))).toBe('simple');
		expect(weaponCategoryOf(parseItemTags('melee'))).toBeUndefined();
	});

	it('armor weight, and nothing for a weight the vocabulary has no word for', () => {
		expect(armorWeightOf(parseItemTags('armor:medium'))).toBe('medium');
		expect(armorWeightOf(parseItemTags('armor:mithral'))).toBeUndefined();
		expect(armorWeightOf(parseItemTags('light'))).toBeUndefined(); // a LIGHT weapon is not armour
	});
});

async function graphWith(rows: string[]): Promise<ContentGraph> {
	const storage = new MemoryStorage();
	await storage.write(
		'c/items_srd.csv',
		['id,systems,source,name_en,category,tags,damage,base_item_id', ...rows].join('\n'),
	);
	const graph = await loadContent(storage, ['c']);
	expect(graph.issues.filter((i) => i.level === 'error')).toEqual([]);
	return graph;
}

const itemRow = (graph: ContentGraph, id: string) => {
	const row = graph.get(`item:${S}:${id}`);
	if (row?.type !== 'item') throw new Error(`no item ${id}`);
	return row;
};

describe('resolveItem', () => {
	it('a magic weapon inherits its base’s tags and damage, and adds its own', async () => {
		const graph = await graphWith([
			`longsword,5.5e,${S},Longsword,weapon,"martial, melee, versatile:1d10",1d8 slashing,`,
			`sword_of_life_stealing,5.5e,${S},Sword of Life Stealing,weapon,attunement,,longsword`,
		]);
		const magic = resolveItem(graph, itemRow(graph, 'sword_of_life_stealing'));
		expect([...magic.tags.keys()]).toEqual(['martial', 'melee', 'versatile', 'attunement']);
		expect(magic.damage).toBe('1d8 slashing');
		expect(weaponCategoryOf(magic.tags)).toBe('martial');
	});

	it('the item’s OWN value wins over the base’s for the same tag', async () => {
		const graph = await graphWith([
			`scale_mail,5.5e,${S},Scale Mail,armor,"armor:medium, ac:14, dex_cap:2",,`,
			`dragon_scale_mail,5.5e,${S},Dragon Scale Mail,armor,"ac:15, attunement",,scale_mail`,
		]);
		const magic = resolveItem(graph, itemRow(graph, 'dragon_scale_mail'));
		expect(tagInt(magic.tags, ITEM_TAG.ac)).toBe(15);
		expect(tagInt(magic.tags, ITEM_TAG.dexCap)).toBe(2); // still inherited
		expect(armorCategoryOf(magic)).toBe('medium');
	});

	it('a base that resolves to nothing leaves the item with only its own tags', async () => {
		const graph = await graphWith([
			`flame_tongue,5.5e,${S},Flame Tongue,weapon,attunement,,no_such_item`,
		]);
		const item = resolveItem(graph, itemRow(graph, 'flame_tongue'));
		expect([...item.tags.keys()]).toEqual(['attunement']);
		// ...and the dangling reference is SAID, since the item silently loses everything it inherits
		expect(graph.issues.map((i) => i.detail)).toContain('base_item_id "no_such_item"');
	});

	it('a shield is a shield by category, whatever its tags say', async () => {
		const graph = await graphWith([`shield,5.5e,${S},Shield,shield,ac:2,,`]);
		expect(armorCategoryOf(resolveItem(graph, itemRow(graph, 'shield')))).toBe('shield');
	});
});

describe('content health', () => {
	it('a numeric tag that is not a number is surfaced, not read as zero', async () => {
		const graph = await graphWith([`odd_plate,5.5e,${S},Odd Plate,armor,"armor:heavy, ac:many",,`]);
		expect(graph.issues.map((i) => i.detail)).toContain('tags: ac:many');
	});
});
