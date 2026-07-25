import { describe, it, expect, beforeAll } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { loadContent, type ContentGraph } from '../content/loader';
import { deriveSheet } from './derive';
import { characterSchema, newCharacter, type Character } from './schema';

/*
 * End-to-end spellcasting derive (data → access → rules → per-class profile). Locks the L1 slot
 * branch (single vs multiclass), L2 (warlock pact separate), and L11 (a DC PER caster class).
 */
const CLASS = 'id,systems,source,name_en,hit_die,saves,caster,spell_ability';
const cls = (id: string, caster: string, ab: string) =>
	`${id},5.5e,SRD 5.2.1,${id},d6,"int,wis",${caster},${ab}`;
const SLOTS =
	'id,systems,source,kind,level,slot_1,slot_2,slot_3,slot_4,slot_5,slot_6,slot_7,slot_8,slot_9';
const slotRow = (kind: string, level: number, ...s: number[]) =>
	`${kind}_${level},5.5e,SRD 5.2.1,${kind},${level},${[...s, 0, 0, 0, 0, 0, 0, 0, 0, 0].slice(0, 9).join(',')}`;
const CAST = 'id,systems,source,class_id,level,cantrips_known,prepared_known';
const castRow = (c: string, lvl: number, cantrips: number | '', prepared: number) =>
	`${c}_${lvl},5.5e,SRD 5.2.1,${c},${lvl},${cantrips},${prepared}`;

let graph: ContentGraph;
beforeAll(async () => {
	const s = new MemoryStorage();
	await s.write(
		'a/classes_srd.csv',
		[
			CLASS,
			cls('wizard', 'full', 'int'),
			cls('cleric', 'full', 'wis'),
			cls('warlock', 'pact', 'cha')
		].join('\n')
	);
	await s.write(
		'a/spell_slots_srd.csv',
		[
			SLOTS,
			slotRow('full', 2, 3),
			slotRow('full', 3, 4, 2),
			slotRow('full', 5, 4, 3, 2),
			slotRow('pact', 5, 0, 0, 2) // 2 slots of 3rd level
		].join('\n')
	);
	await s.write(
		'a/class_casting_srd.csv',
		[
			CAST,
			castRow('wizard', 3, 3, 6),
			castRow('wizard', 5, 4, 9),
			castRow('cleric', 2, 3, 5),
			castRow('warlock', 5, 2, 6)
		].join('\n')
	);
	graph = await loadContent(s, ['a']);
	expect(graph.issues.filter((i) => i.level === 'error')).toEqual([]);
});

const make = (build: (c: Character) => void): Character => {
	const c = newCharacter('x', 'X', '5.5e');
	c.build.abilities = { str: 10, dex: 10, con: 10, int: 16, wis: 16, cha: 16 };
	build(c);
	return characterSchema.parse(c);
};

describe('deriveSpellcasting', () => {
	it('single caster: own table, one profile, max spell level from slots', () => {
		const wiz = make((c) => (c.build.classes = [{ class: 'class:SRD 5.2.1:wizard', level: 5 }]));
		const sc = deriveSheet(wiz, graph).spellcasting;
		expect(sc.classes).toHaveLength(1);
		expect(sc.classes[0]!.ability).toBe('int');
		expect(sc.classes[0]!.saveDC.value).toBe(14); // 8 + 3(prof L5) + 3(int)
		expect(sc.classes[0]!.maxSpellLevel).toBe(3); // full@5 → [4,3,2]
		expect(sc.classes[0]!.preparedCap).toBe(9); // class_casting wizard_5
		expect(sc.pools.map((p) => p.spellLevel)).toEqual([1, 2, 3]); // shared long-rest pool
	});

	it('fills down a sparse class_casting table: L4 wizard uses the L3 row, not 0 (E5)', () => {
		// the fixture defines wizard rows only at level 3 (prepared 6) and 5 (prepared 9) — no level 4
		const wiz4 = make((c) => (c.build.classes = [{ class: 'class:SRD 5.2.1:wizard', level: 4 }]));
		const sc = deriveSheet(wiz4, graph).spellcasting;
		expect(sc.classes[0]!.preparedCap).toBe(6); // filled down from wizard_3, not a 0/formula gap
	});

	it('multiclass: TWO DCs (L11), shared pool at summed level, per-class learnable max', () => {
		const gish = make((c) => {
			c.build.classes = [
				{ class: 'class:SRD 5.2.1:wizard', level: 3 },
				{ class: 'class:SRD 5.2.1:cleric', level: 2 }
			];
		});
		const sc = deriveSheet(gish, graph).spellcasting;
		expect(sc.classes.map((c) => c.ability).sort()).toEqual(['int', 'wis']); // two DCs
		expect(sc.casterLevel).toBe(5); // 3 + 2, summed
		expect(sc.pools.map((p) => p.spellLevel)).toEqual([1, 2, 3]); // full@5, shared
		// but each class only learns up to ITS OWN table's max
		const wiz = sc.classes.find((c) => c.classId === 'wizard')!;
		const cle = sc.classes.find((c) => c.classId === 'cleric')!;
		expect(wiz.maxSpellLevel).toBe(2); // full@3 → [4,2]
		expect(cle.maxSpellLevel).toBe(1); // full@2 → [3]
	});

	it('warlock: pact pool is separate (short rest, forced upcast), no shared level', () => {
		const wl = make((c) => (c.build.classes = [{ class: 'class:SRD 5.2.1:warlock', level: 5 }]));
		const sc = deriveSheet(wl, graph).spellcasting;
		expect(sc.casterLevel).toBe(0); // pact excluded from shared level
		expect(sc.classes[0]!.isPact).toBe(true);
		const pact = sc.pools.find((p) => p.forcedUpcast);
		expect(pact).toMatchObject({ spellLevel: 3, max: 2, recharge: 'short' });
	});
});

/*
 * B25: a casting SUBCLASS (Eldritch Knight — a homebrew/PHB drop-in, since the shipped SRD has none)
 * brings casting online off the SUBCLASS row's caster columns, gated by caster_from_level. The base
 * class (Fighter) is caster:none, so before that level there's no casting at all.
 */
describe('deriveSpellcasting: casting subclass (B25)', () => {
	let g: ContentGraph;
	beforeAll(async () => {
		const s = new MemoryStorage();
		await s.write(
			'a/classes_srd.csv',
			[CLASS, 'fighter,5.5e,SRD 5.2.1,fighter,d10,"str,con",none,'].join('\n')
		);
		await s.write(
			'a/subclasses_srd.csv',
			[
				'id,systems,source,name_en,class_id,caster,caster_share,prepare_style,slot_table,spell_ability,caster_from_level',
				// Eldritch Knight: a one-third INT caster from Fighter level 3
				'eldritch_knight,5.5e,SRD 5.2.1,Eldritch Knight,fighter,third,third,known,third,int,3'
			].join('\n')
		);
		await s.write(
			'a/spell_slots_srd.csv',
			// third-caster table: L3 → two 1st-level slots; L7 → three 1st + one 2nd
			[SLOTS, slotRow('third', 3, 2), slotRow('third', 7, 4, 2)].join('\n')
		);
		await s.write(
			'a/class_casting_srd.csv',
			// class_casting keyed by the SUBCLASS id (the owner of the casting progression)
			[CAST, castRow('eldritch_knight', 3, 2, 3)].join('\n')
		);
		g = await loadContent(s, ['a']);
		expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
	});

	const ek = (level: number): Character =>
		make((c) => {
			c.build.classes = [
				{ class: 'class:SRD 5.2.1:fighter', level, subclass: 'subclass:SRD 5.2.1:eldritch_knight' }
			];
		});

	it('below caster_from_level: Fighter 2 EK does not cast', () => {
		expect(deriveSheet(ek(2), g).spellcasting.classes).toHaveLength(0);
	});

	it('at caster_from_level: Fighter 3 EK gets slots, an INT DC, and a prepared cap from the subclass', () => {
		const sc = deriveSheet(ek(3), g).spellcasting;
		expect(sc.classes).toHaveLength(1);
		const p = sc.classes[0]!;
		expect(p.ability).toBe('int');
		expect(p.saveDC.value).toBe(13); // 8 + 2(prof L3) + 3(int 16)
		expect(p.maxSpellLevel).toBe(1); // third@3 → [2]
		expect(p.preparedCap).toBe(3); // class_casting eldritch_knight_3
		expect(sc.pools.map((x) => x.spellLevel)).toEqual([1]); // one 1st-level slot tier
		expect(sc.pools[0]!.max).toBe(2);
	});

	it('a plain Fighter 3 (no EK subclass) still does not cast', () => {
		const plain = make(
			(c) => (c.build.classes = [{ class: 'class:SRD 5.2.1:fighter', level: 3 }])
		);
		expect(deriveSheet(plain, g).spellcasting.classes).toHaveLength(0);
	});
});
