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
			`hardy,5.5e,${S},Hardy,flat_bonus:con+2,medium,30,humanoid`
		].join('\n')
	);
	await st.write(
		'c/species_options_srd.csv',
		[
			'id,systems,source,name_en,effects,species_id,kind,option_label',
			`stoic,5.5e,${S},Stoic,flat_bonus:wis+1,hardy,subrace,Subrace`
		].join('\n')
	);
	await st.write(
		'c/items_srd.csv',
		[
			'id,systems,source,name_en,effects,category,item_type,ac,armor_dex_cap',
			`leather_armor,5.5e,${S},Leather Armor,,armor,light armor,11,`,
			`shield,5.5e,${S},Shield,,shield,shield,2,`
		].join('\n')
	);
	await st.write(
		'c/subclasses_srd.csv',
		[
			'id,systems,source,name_en,effects,class_id',
			`evoker,5.5e,${S},Evoker,flat_bonus:skill.arcana+1,wizard`
		].join('\n')
	);
	await st.write(
		'c/class_features_srd.csv',
		[
			'id,systems,source,name_en,effects,class_id,level,subclass_id',
			`arcane_ward,5.5e,${S},Arcane Ward,grant_resource:arcane_ward:3:long,wizard,2,`,
			`spell_mastery,5.5e,${S},Spell Mastery,flat_bonus:ac+1,wizard,18,`,
			`sculpt_spells,5.5e,${S},Sculpt Spells,flat_bonus:save.dex+1,wizard,2,evoker`,
			`overchannel,5.5e,${S},Overchannel,flat_bonus:ac+3,wizard,14,evoker`
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
	c.build.inventory = [{ item: `item:${S}:leather_armor`, qty: 1, equipped: true, attuned: false }];
	c.play.effects = [
		{ iid: '1', label: 'Shield of Faith', effects: ['flat_bonus:ac+2'], positive: true }
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
		const c = s.spellcasting.classes[0];
		expect(c?.ability).toBe('int');
		expect(c?.saveDC.value).toBe(13); // 8 + 2 + 3
		expect(c?.attack.value).toBe(5); // 2 + 3
	});

	it('carries speed from species and capacity from STR', () => {
		const s = deriveSheet(wizard(), graph);
		expect(s.speed.value).toBe(30);
		expect(s.carryingCapacity.value).toBe(150); // STR 10 × 15
	});

	it('adds a shield when raised (the play-state toggle, not the inventory flag)', () => {
		const c = wizard();
		c.play.shieldRaised = true;
		const s = deriveSheet(characterSchema.parse(c), graph);
		expect(s.ac.value).toBe(17); // leather 11 + DEX 2 + shield 2 + faith 2
		expect(s.ac.trace.map((x) => x.source)).toContain('Shield');
	});

	it('applies a custom flat_bonus to a specific skill and save (GM modifier)', () => {
		const c = wizard();
		c.play.effects = [
			{ iid: 'm1', label: '+2 Stealth', effects: ['flat_bonus:skill.stealth+2'], positive: true },
			{ iid: 'm2', label: '+1 DEX save', effects: ['flat_bonus:save.dex+1'], positive: true }
		];
		const s = deriveSheet(characterSchema.parse(c), graph);
		// DEX 14 (+2): stealth = +2 mod + 2 custom = 4; dex save = +2 mod + 1 custom = 3
		expect(s.skills.stealth!.value).toBe(4);
		expect(s.abilities.dex.save.value).toBe(3);
	});

	it('cascades a species-option (subrace) ability bonus on top of the species', () => {
		const c = wizard();
		c.build.speciesOption = `species_option:${S}:stoic`;
		const s = deriveSheet(characterSchema.parse(c), graph);
		// CON 12 base +2 (Hardy species) = 14; WIS 10 +1 (Stoic subrace) = 11
		expect(s.abilities.con.score).toBe(14);
		expect(s.abilities.wis.score).toBe(11);
	});

	it('hp_max effects flow through the seam (Toughness/Aid)', () => {
		const c = wizard();
		c.play.effects = [{ iid: 'a', label: 'Aid', effects: ['flat_bonus:hp_max+5'], positive: true }];
		const s = deriveSheet(characterSchema.parse(c), graph);
		expect(s.maxHp.value).toBe(25); // 20 base + 5
		expect(s.maxHp.trace.map((t) => t.source)).toContain('Aid');
	});

	it('advantage on the underlying check moves the passive by +5 (and cancels vs disadvantage)', () => {
		const c = wizard();
		c.play.effects = [
			{ iid: 'a', label: 'Owl', effects: ['advantage:skill.perception'], positive: true }
		];
		const s = deriveSheet(characterSchema.parse(c), graph);
		expect(s.passives.perception.value).toBe(15); // 10 + 0 mod + 5 advantage

		c.play.effects.push({
			iid: 'p',
			label: 'Poisoned',
			effects: ['disadvantage:skills'],
			positive: false
		});
		const cancelled = deriveSheet(characterSchema.parse(c), graph);
		expect(cancelled.passives.perception.value).toBe(10); // adv + dis cancel
	});

	it('granted expertise is one ladder level (never expertise-without-proficiency)', () => {
		const c = wizard();
		c.play.effects = [
			{
				iid: 'e',
				label: 'Mentor',
				effects: ['grant_proficiency:expertise:skill.stealth'],
				positive: true
			}
		];
		const s = deriveSheet(characterSchema.parse(c), graph);
		expect(s.skills.stealth!.prof).toBe('expertise');
		expect(s.skills.stealth!.value).toBe(6); // DEX +2 + prof 2 × 2
	});

	it('grants skill and save proficiency from a grant_proficiency effect', () => {
		const c = wizard();
		c.play.effects = [
			{
				iid: 'g',
				label: 'Skilled',
				effects: ['grant_proficiency:stealth', 'grant_proficiency:save.con'],
				positive: true
			}
		];
		const s = deriveSheet(characterSchema.parse(c), graph);
		expect(s.skills.stealth!.prof).toBe('proficient'); // was 'none'
		expect(s.skills.stealth!.value).toBe(4); // DEX +2 + prof +2
		expect(s.abilities.con.save.trace.some((t) => t.layer === 'proficiency')).toBe(true);
	});

	it('collects damage defenses from resist_immune effects (mode + bare default)', () => {
		const c = wizard();
		c.play.effects = [
			{
				iid: 'd',
				label: 'Wards',
				effects: [
					'resist_immune:resist:fire',
					'resist_immune:immune:poison',
					'resist_immune:cold' // bare → defaults to resistance
				],
				positive: true
			}
		];
		const s = deriveSheet(characterSchema.parse(c), graph);
		expect(s.defenses.resist).toEqual(['fire', 'cold']);
		expect(s.defenses.immune).toEqual(['poison']);
		expect(s.defenses.vulnerable).toEqual([]);
	});

	it('collects trackable resources from grant_resource effects', () => {
		const c = wizard();
		c.play.effects = [
			{
				iid: 'r',
				label: 'Class features',
				effects: ['grant_resource:rage:3:long', 'grant_resource:ki:5:short'],
				positive: true
			}
		];
		const s = deriveSheet(characterSchema.parse(c), graph);
		const byId = Object.fromEntries(s.resources.map((r) => [r.id, r]));
		expect(byId.rage).toMatchObject({ name: 'Rage', max: 3, recharge: 'long' });
		expect(byId.ki).toMatchObject({ name: 'Ki', max: 5, recharge: 'short' });
	});

	it('auto-calc off drops the effect layers (base values only)', () => {
		const c = wizard();
		c.play.autoCalc = false;
		const s = deriveSheet(characterSchema.parse(c), graph);
		expect(s.ac.value).toBe(13); // leather 11 + DEX 2, no Shield of Faith
		expect(s.ac.trace.map((x) => x.source)).not.toContain('Shield of Faith');
	});

	it('gathers class-feature effects up to the class level (and not above it)', () => {
		const s = deriveSheet(wizard(), graph); // wizard 3
		// Arcane Ward (L2) applies → its resource pool exists
		expect(s.resources.map((r) => r.id)).toContain('arcane_ward');
		// Spell Mastery (L18) must NOT apply at level 3
		expect(s.ac.trace.map((t) => t.source)).not.toContain('Spell Mastery');
	});

	it('applies subclass features only when that subclass is chosen', () => {
		const plain = deriveSheet(wizard(), graph);
		// no subclass chosen → Sculpt Spells (evoker L2) must not touch the DEX save
		expect(plain.abilities.dex.save.trace.map((t) => t.source)).not.toContain('Sculpt Spells');

		const c = wizard();
		c.build.classes = [{ class: `class:${S}:wizard`, level: 3, subclass: `subclass:${S}:evoker` }];
		const s = deriveSheet(characterSchema.parse(c), graph);
		// the subclass row's own tokens + its L2 feature apply; its L14 feature does not
		expect(s.skills.arcana!.trace.map((t) => t.source)).toContain('Evoker');
		expect(s.abilities.dex.save.trace.map((t) => t.source)).toContain('Sculpt Spells');
		expect(s.ac.trace.map((t) => t.source)).not.toContain('Overchannel');
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

describe('deriveSheet · L2 value expressions (EXPR-2)', () => {
	async function exprGraph(): Promise<ContentGraph> {
		const st = new MemoryStorage();
		await st.write(
			'c/classes_srd.csv',
			['id,systems,source,name_en,hit_die,saves', `monk,5.5e,${S},Monk,d8,"str,dex"`].join('\n')
		);
		await st.write(
			'c/species_srd.csv',
			[
				'id,systems,source,name_en,effects,size,speed,creature_type',
				// AC scales with character level: ceil(level/2); Ki pool = monk level
				`ward,5.5e,${S},Ward,flat_bonus:ac+ceil(level/2),medium,30,humanoid`
			].join('\n')
		);
		await st.write(
			'c/class_features_srd.csv',
			[
				'id,systems,source,name_en,effects,class_id,level,subclass_id',
				`ki,5.5e,${S},Ki,grant_resource:ki:class_level.monk:short,monk,1,`
			].join('\n')
		);
		const g = await loadContent(st, ['c']);
		expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
		return g;
	}

	function monk(level: number): Character {
		const c = newCharacter('kwai', 'Kwai', '5.5e');
		c.build.species = `species:${S}:ward`;
		c.build.classes = [{ class: `class:${S}:monk`, level }];
		c.build.abilities = { str: 12, dex: 16, con: 12, int: 10, wis: 14, cha: 10 };
		return characterSchema.parse(c);
	}

	it('folds a level-scaling AC expression into the sheet', async () => {
		const g = await exprGraph();
		// unarmored AC = 10 + dex(3) = 13; + ceil(level/2)
		expect(deriveSheet(monk(4), g).ac.value).toBe(13 + 2); // ceil(4/2)=2
		expect(deriveSheet(monk(9), g).ac.value).toBe(13 + 5); // ceil(9/2)=5
	});

	it('resolves a computed resource pool (Ki = monk level)', async () => {
		const g = await exprGraph();
		const ki = deriveSheet(monk(6), g).resources.find((r) => r.id === 'ki');
		expect(ki?.max).toBe(6);
	});
});

describe('deriveSheet · L2 condition guards (EXPR-3)', () => {
	async function guardGraph(): Promise<ContentGraph> {
		const st = new MemoryStorage();
		await st.write(
			'c/classes_srd.csv',
			[
				'id,systems,source,name_en,hit_die,saves',
				`barbarian,5.5e,${S},Barbarian,d12,"str,con"`
			].join('\n')
		);
		await st.write(
			'c/species_srd.csv',
			[
				'id,systems,source,name_en,effects,size,speed,creature_type',
				// Unarmored Defense: only applies with no armor; a CON-save bonus while bloodied
				`brute,5.5e,${S},Brute,armor_type==none ? set_override:ac:13; is_bloodied ? flat_bonus:save.con+2,medium,30,humanoid`
			].join('\n')
		);
		const g = await loadContent(st, ['c']);
		expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
		return g;
	}

	function brute(hpCurrent: number, hpMax: number): Character {
		const c = newCharacter('grog', 'Grog', '5.5e');
		c.build.species = `species:${S}:brute`;
		c.build.classes = [{ class: `class:${S}:barbarian`, level: 5 }];
		c.build.abilities = { str: 16, dex: 14, con: 16, int: 8, wis: 10, cha: 8 };
		c.play.hp = { current: hpCurrent, max: hpMax, temp: 0 };
		return characterSchema.parse(c);
	}

	it('applies an enum-guarded override only when the guard holds', async () => {
		const g = await guardGraph();
		// no armor → Unarmored Defense sets AC to 13 (overrides the 10+dex base)
		const healthy = deriveSheet(brute(50, 50), g);
		expect(healthy.ac.value).toBe(13);
	});

	it('applies a bloodied guard only below half HP', async () => {
		const g = await guardGraph();
		// CON save base = +3 mod + 3 prof (barbarian) = 6; bloodied adds +2
		expect(deriveSheet(brute(50, 50), g).abilities.con.save.value).toBe(6); // healthy: no bonus
		expect(deriveSheet(brute(20, 50), g).abilities.con.save.value).toBe(8); // bloodied (≤25): +2
	});

	it('reports no derive issues on clean guarded content', async () => {
		const g = await guardGraph();
		expect(deriveSheet(brute(50, 50), g).deriveIssues).toEqual([]);
	});

	it('exposes the resolved (guard-stripped) effect list for the roll path (B21)', async () => {
		const g = await guardGraph();
		const tokens = deriveSheet(brute(20, 50), g).resolvedEffects.flatMap((e) => e.tokens);
		expect(tokens).toContain('flat_bonus:save.con+2'); // bloodied guard passed → stripped
		expect(tokens.some((t) => t.includes('?'))).toBe(false); // no raw guards leak through
	});
});

describe('deriveSheet · guard ctx is fail-closed (two-pass resolve)', () => {
	async function condGraph(): Promise<ContentGraph> {
		const st = new MemoryStorage();
		await st.write(
			'c/classes_srd.csv',
			[
				'id,systems,source,name_en,hit_die,saves',
				`barbarian,5.5e,${S},Barbarian,d12,"str,con"`
			].join('\n')
		);
		await st.write(
			'c/species_srd.csv',
			[
				'id,systems,source,name_en,effects,size,speed,creature_type',
				`brute,5.5e,${S},Brute,is_raging ? flat_bonus:ac+2,medium,30,humanoid`
			].join('\n')
		);
		await st.write(
			'c/conditions_srd.csv',
			[
				'id,systems,source,name_en,effects,negative',
				`rage,5.5e,${S},Rage,flat_bonus:save.str+1,false`,
				`marked,5.5e,${S},Marked,flat_bonus:ac+5,true`
			].join('\n')
		);
		const g = await loadContent(st, ['c']);
		expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
		return g;
	}

	function brute(): Character {
		const c = newCharacter('grog', 'Grog', '5.5e');
		c.build.species = `species:${S}:brute`;
		c.build.classes = [{ class: `class:${S}:barbarian`, level: 5 }];
		c.build.abilities = { str: 16, dex: 14, con: 16, int: 8, wis: 10, cha: 8 };
		c.play.hp = { current: 50, max: 50, temp: 0 };
		return characterSchema.parse(c);
	}

	it('a FALSE-guarded apply_condition does not activate its condition (no fail-open)', async () => {
		const g = await condGraph();
		const c = brute();
		// guard is false at full HP → rage must NOT come active → is_raging stays false
		c.play.effects = [
			{
				iid: 'f',
				label: 'Frenzy',
				effects: ['hp_percent<=25 ? apply_condition:rage'],
				positive: true
			}
		];
		const s = deriveSheet(c, g);
		expect(s.ac.trace.map((t) => t.source)).not.toContain('Brute'); // is_raging ? +2 AC off
		expect(s.abilities.str.save.trace.map((t) => t.source)).not.toContain('Frenzy → Rage');
	});

	it('a self-fulfilling has_condition guard stays false (cannot bootstrap itself)', async () => {
		const g = await condGraph();
		const c = brute();
		c.play.effects = [
			{
				iid: 's',
				label: 'Loop',
				effects: ['has_condition.marked ? apply_condition:marked'],
				positive: false
			}
		];
		const s = deriveSheet(c, g);
		expect(s.ac.trace.map((t) => t.source)).not.toContain('Loop → Marked'); // no +5 AC
	});

	it('an UNguarded apply_condition feeds pass-2 guards (is_raging chain works)', async () => {
		const g = await condGraph();
		const c = brute();
		c.play.effects = [
			{ iid: 'r', label: 'Raging', effects: ['apply_condition:rage'], positive: true }
		];
		const s = deriveSheet(c, g);
		// the species' `is_raging ? flat_bonus:ac+2` now applies
		expect(s.ac.trace.some((t) => t.source === 'Brute' && t.amount === 2)).toBe(true);
		// and the rage condition's own tokens expanded
		expect(s.abilities.str.save.trace.map((t) => t.source)).toContain('Raging → Rage');
	});
});

describe('deriveSheet · unsupported ability-score tokens are surfaced, never silent', () => {
	async function abilityGraph(): Promise<ContentGraph> {
		const st = new MemoryStorage();
		await st.write(
			'c/classes_srd.csv',
			['id,systems,source,name_en,hit_die,saves', `monk,5.5e,${S},Monk,d8,"str,dex"`].join('\n')
		);
		await st.write(
			'c/species_srd.csv',
			[
				'id,systems,source,name_en,effects,size,speed,creature_type',
				// an expression and a guard on ability targets — both await the DAG, must be reported
				`odd,5.5e,${S},Odd,flat_bonus:str+ceil(level/4); is_bloodied ? flat_bonus:con+2,medium,30,humanoid`
			].join('\n')
		);
		const g = await loadContent(st, ['c']);
		return g;
	}

	it('reports expression/guarded ability bonuses as derive issues and does not apply them', async () => {
		const g = await abilityGraph();
		const c = newCharacter('odd', 'Odd', '5.5e');
		c.build.species = `species:${S}:odd`;
		c.build.classes = [{ class: `class:${S}:monk`, level: 8 }];
		c.build.abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
		const s = deriveSheet(characterSchema.parse(c), g);
		expect(s.abilities.str.score).toBe(10); // ceil(8/4)=2 NOT applied (deferred DAG)
		expect(s.abilities.con.score).toBe(10);
		const reasons = s.deriveIssues.map((i) => i.reason).join(' ');
		expect(reasons).toContain('expression on an ability-score bonus');
		expect(reasons).toContain('guard on an ability-score bonus');
	});
});

describe('deriveSheet · spellcasting_mod reads the carrying class (SPEC4)', () => {
	async function multiGraph(): Promise<ContentGraph> {
		const st = new MemoryStorage();
		await st.write(
			'c/classes_srd.csv',
			[
				'id,systems,source,name_en,hit_die,saves,caster,spell_ability',
				`wizard,5.5e,${S},Wizard,d6,"int,wis",full,int`,
				`cleric,5.5e,${S},Cleric,d8,"wis,cha",full,wis`
			].join('\n')
		);
		await st.write(
			'c/class_features_srd.csv',
			[
				'id,systems,source,name_en,effects,class_id,level,subclass_id',
				// a cleric feature reading spellcasting_mod — must use WIS, not the primary (wizard/INT)
				`blessed_ward,5.5e,${S},Blessed Ward,flat_bonus:save.wis+spellcasting_mod,cleric,1,`
			].join('\n')
		);
		const g = await loadContent(st, ['c']);
		expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
		return g;
	}

	it('a class feature token uses ITS class casting mod; runtime tokens use the primary caster', async () => {
		const g = await multiGraph();
		const c = newCharacter('multi', 'Multi', '5.5e');
		c.build.classes = [
			{ class: `class:${S}:wizard`, level: 3 }, // primary caster (higher level)
			{ class: `class:${S}:cleric`, level: 2 }
		];
		c.build.abilities = { str: 10, dex: 10, con: 10, int: 16, wis: 14, cha: 10 };
		// a runtime (unscoped) token: primary caster = wizard → INT +3
		c.play.effects = [
			{
				iid: 'u',
				label: 'Focus',
				effects: ['flat_bonus:save.str+spellcasting_mod'],
				positive: true
			}
		];
		const s = deriveSheet(characterSchema.parse(c), g);
		const wisSave = s.abilities.wis.save.trace.find((t) => t.source === 'Blessed Ward');
		expect(wisSave?.amount).toBe(2); // cleric feature → WIS mod (+2), NOT wizard INT (+3)
		const strSave = s.abilities.str.save.trace.find((t) => t.source === 'Focus');
		expect(strSave?.amount).toBe(3); // unscoped → primary caster (wizard, INT +3)
	});
});

describe('deriveSheet · set_override with a dice value degrades to a note', () => {
	it('never silently drops the token', async () => {
		const st = new MemoryStorage();
		await st.write(
			'c/classes_srd.csv',
			['id,systems,source,name_en,hit_die,saves', `monk,5.5e,${S},Monk,d8,"str,dex"`].join('\n')
		);
		const g = await loadContent(st, ['c']);
		const c = newCharacter('x', 'X', '5.5e');
		c.build.classes = [{ class: `class:${S}:monk`, level: 1 }];
		c.build.abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
		c.play.effects = [
			{ iid: 'd', label: 'Weird', effects: ['set_override:ac:1d6'], positive: true }
		];
		const s = deriveSheet(characterSchema.parse(c), g);
		expect(s.ac.value).toBe(10); // base unarmored, override NOT applied
		expect(s.ac.notes?.join(' ')).toContain('unresolved');
	});
});
