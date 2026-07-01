import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { loadContent, type ContentGraph } from '../content/loader';
import { characterSchema, newCharacter, type Character } from './schema';
import { deriveSheet } from './derive';

const S = 'SRD 5.2.1';

async function graphOf(): Promise<ContentGraph> {
	const st = new MemoryStorage();
	await st.write(
		'c/classes_srd.csv',
		[
			'id,systems,source,name_en,hit_die,saves,caster,spell_ability',
			`wizard,5.5e,${S},Wizard,d6,"int,wis",full,int`
		].join('\n')
	);
	await st.write(
		'c/species_srd.csv',
		[
			'id,systems,source,name_en,effects,size,speed,creature_type',
			`hardy,5.5e,${S},Hardy,flat-bonus:con+2,medium,30,humanoid`
		].join('\n')
	);
	await st.write(
		'c/items_srd.csv',
		[
			'id,systems,source,name_en,effects,category,item_type,ac,armor_dex_cap',
			`leather-armor,5.5e,${S},Leather Armor,,armor,light armor,11,`,
			`shield,5.5e,${S},Shield,,shield,shield,2,`
		].join('\n')
	);
	const g = await loadContent(st, ['c']);
	expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
	return g;
}

function wizard(): Character {
	const c = newCharacter('mordenkainen', 'Mordenkainen', '5.5e');
	c.build.species = `species:${S}:hardy`;
	c.build.classes = [{ class: `class:${S}:wizard`, level: 3 }];
	c.build.abilities = { str: 10, dex: 14, con: 12, int: 16, wis: 10, cha: 10 };
	c.build.inventory = [{ item: `item:${S}:leather-armor`, qty: 1, equipped: true, attuned: false }];
	c.play.effects = [
		{ iid: '1', label: 'Shield of Faith', effects: ['flat-bonus:ac+2'], positive: true }
	];
	return characterSchema.parse(c);
}

describe('deriveSheet aggregator', () => {
	let graph: ContentGraph;
	beforeEach(async () => {
		graph = await graphOf();
	});

	it('cascades a species ability-score bonus into the modifier', () => {
		const s = deriveSheet(wizard(), graph);
		expect(s.abilities.con.baseScore).toBe(12);
		expect(s.abilities.con.score).toBe(14); // +2 from Hardy
		expect(s.abilities.con.mod).toBe(2);
		expect(s.level).toBe(3);
		expect(s.proficiencyBonus).toBe(2);
	});

	it('derives saves with class proficiencies', () => {
		const s = deriveSheet(wizard(), graph);
		expect(s.abilities.int.save.value).toBe(5); // +3 INT + 2 prof (wizard proficient)
		expect(s.abilities.str.save.value).toBe(0); // not proficient
	});

	it('computes AC from equipped armor + a runtime effect, with provenance', () => {
		const s = deriveSheet(wizard(), graph);
		// leather 11 + DEX 2 + Shield of Faith 2 = 15
		expect(s.ac.value).toBe(15);
		expect(s.ac.trace.map((c) => c.source)).toContain('Shield of Faith');
	});

	it('sums max HP per class (SRD fixed) using the effective CON', () => {
		const s = deriveSheet(wizard(), graph);
		expect(s.maxHp.value).toBe(20); // d6 L3, CON 14 (+2): 8 + 6 + 6
	});

	it('derives spellcasting DC and attack for a caster', () => {
		const s = deriveSheet(wizard(), graph);
		expect(s.spellcasting?.ability).toBe('int');
		expect(s.spellcasting?.saveDC.value).toBe(13); // 8 + 2 + 3
		expect(s.spellcasting?.attack.value).toBe(5); // 2 + 3
	});

	it('carries speed from species and capacity from STR', () => {
		const s = deriveSheet(wizard(), graph);
		expect(s.speed.value).toBe(30);
		expect(s.carryingCapacity.value).toBe(150); // STR 10 × 15
	});

	it('adds a shield when equipped', () => {
		const c = wizard();
		c.build.inventory.push({ item: `item:${S}:shield`, qty: 1, equipped: true, attuned: false });
		const s = deriveSheet(characterSchema.parse(c), graph);
		expect(s.ac.value).toBe(17); // leather 11 + DEX 2 + shield 2 + faith 2
	});

	it('reports a missing content ref instead of crashing', () => {
		const c = wizard();
		c.build.species = `species:${S}:does-not-exist`;
		const s = deriveSheet(characterSchema.parse(c), graph);
		expect(s.missing).toContain(`species:${S}:does-not-exist`);
		// CON bonus is gone (species unresolved), so CON is base 12 → mod +1
		expect(s.abilities.con.mod).toBe(1);
	});
});
