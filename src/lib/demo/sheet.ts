/*
 * A self-contained demo character + a small in-memory content graph, so the Combat screen
 * shows REAL computed stats (rules core + effects + aggregator) without needing the full
 * content pipeline wired to the web build yet. Replaced by real content loading (FetchStorage
 * on web, Tauri fs on desktop) once that lands.
 */
import { MemoryStorage } from '$lib/storage/memory';
import { loadContent, type ContentGraph } from '$lib/content/loader';
import { characterSchema, newCharacter, type Character } from '$lib/character/schema';

const S = 'SRD 5.2.1';

export async function loadDemo(): Promise<{ character: Character; graph: ContentGraph }> {
	const st = new MemoryStorage();
	await st.write(
		'demo/classes_srd.csv',
		[
			'id,systems,source,name_en,hit_die,saves,caster,spell_ability',
			`wizard,5.5e,${S},Wizard,d6,"int,wis",full,int`
		].join('\n')
	);
	await st.write(
		'demo/species_srd.csv',
		[
			'id,systems,source,name_en,effects,size,speed,creature_type',
			`stoutheart,5.5e,${S},Stoutheart,flat-bonus:con+2;resist-immune:poison,medium,30,humanoid`
		].join('\n')
	);
	await st.write(
		'demo/items_srd.csv',
		[
			'id,systems,source,name_en,effects,category,item_type,ac,armor_dex_cap,attunement',
			`leather-armor,5.5e,${S},Leather Armor,,armor,light armor,11,,false`,
			`cloak-of-protection,5.5e,${S},Cloak of Protection,flat-bonus:ac+1;flat-bonus:saves+1,gear,wondrous item,,,true`
		].join('\n')
	);
	const graph = await loadContent(st, ['demo']);

	const c = newCharacter('valen', 'Valen the Blue', '5.5e');
	c.build.species = `species:${S}:stoutheart`;
	c.build.classes = [{ class: `class:${S}:wizard`, level: 3 }];
	c.build.abilities = { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 };
	c.build.skills = ['arcana', 'history', 'investigation', 'perception'];
	c.build.inventory = [
		{ item: `item:${S}:leather-armor`, qty: 1, equipped: true, attuned: false },
		{ item: `item:${S}:cloak-of-protection`, qty: 1, equipped: true, attuned: true }
	];
	c.play.hp = { current: 14, max: undefined, temp: 0 };
	c.play.effects = [
		{
			iid: 'bless',
			label: 'Bless',
			effects: ['flat-bonus:saves+1d4'],
			positive: true,
			durationRounds: 10,
			startedRound: 0
		}
	];

	return { character: characterSchema.parse(c), graph };
}
