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
	`${kind}-${level},5.5e,SRD 5.2.1,${kind},${level},${[...s, 0, 0, 0, 0, 0, 0, 0, 0, 0].slice(0, 9).join(',')}`;
const CAST = 'id,systems,source,class_id,level,cantrips_known,prepared_known';
const castRow = (c: string, lvl: number, cantrips: number | '', prepared: number) =>
	`${c}-${lvl},5.5e,SRD 5.2.1,${c},${lvl},${cantrips},${prepared}`;

let graph: ContentGraph;
beforeAll(async () => {
	const s = new MemoryStorage();
	await s.write('a/_pack.json', JSON.stringify({ source: 'SRD 5.2.1', systems: ['5.5e'] }));
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
		expect(sc.classes[0]!.preparedCap).toBe(9); // class_casting wizard-5
		expect(sc.pools.map((p) => p.spellLevel)).toEqual([1, 2, 3]); // shared long-rest pool
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
