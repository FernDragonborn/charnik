import { describe, it, expect, beforeAll } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import type { ContentGraph } from './loader';
import {
	bonusRowFor,
	instanceName,
	instanceQuestions,
	instanceRowId,
	instancesForQuery,
	parseInstanceRowId,
	type InstanceScope,
} from './item-instance';
import { addItemInstance } from '$lib/character/inventory';
import type { System } from '$lib/rules/pipeline';

describe.each([
	['srd-2014', '5e'],
	['srd-2024', '5.5e'],
] as const)('item instances (%s)', (pack, system: System) => {
	let graph: ContentGraph;
	let scope: InstanceScope;
	beforeAll(async () => {
		graph = await loadPacks(pack);
		scope = { graph, system, locale: 'en', isActive: () => true };
	});
	const row = (id: string) => {
		const found = graph.get(`item:${graph.list('item').find((r) => r.id === id)?.source}:${id}`);
		if (found?.type !== 'item') throw new Error(`no item ${id}`);
		return found;
	};

	it('a template +N row asks which weapon and which bonus; a Shield +N only which bonus', () => {
		const weapon = instanceQuestions(scope, row('weapon_1_2_or_3'));
		expect(weapon.bases.map((b) => b.name)).toContain('Longsword');
		expect(weapon.rungs.map((r) => r.bonus)).toEqual([1, 2, 3]);
		const ammunition = instanceQuestions(scope, row('ammunition_1_2_or_3'));
		expect(ammunition.bases.some((b) => b.name.startsWith('Arrows'))).toBe(true);
		expect(ammunition.bases.map((b) => b.name)).not.toContain('Longsword');
		const shield = instanceQuestions(scope, row('shield_1_2_or_3'));
		expect(shield.bases).toEqual([]);
		expect(shield.rungs.map((r) => r.bonus)).toEqual([1, 2, 3]);
	});

	it('a row found as one of several kinds asks which: a variety by its row, a word by its id', () => {
		const belt = instanceQuestions(scope, row('belt_of_giant_strength'));
		expect(belt.choices).toHaveLength(5);
		expect(belt.choices.every((c) => c.name && c.rarity)).toBe(true);
		const hill = belt.choices.find((c) => c.id === 'belt_of_hill_giant_strength');
		// a belt told which it is goes by that belt's name
		expect(
			instanceName({ graph, locale: 'en' }, row('belt_of_giant_strength'), { choice: hill?.id }),
		).toBe(hill?.name);
		const ring = instanceQuestions(scope, row('ring_of_resistance'));
		expect(ring.choices.map((c) => c.id)).toContain('fire');
		expect(ring.choices.every((c) => c.name === undefined)).toBe(true);
		// a ring answered with a word keeps the book's name; the word is said beside it by the view
		expect(
			instanceName({ graph, locale: 'en' }, row('ring_of_resistance'), { choice: 'fire' }),
		).toBe(undefined);
	});

	it('two rings of different kinds are two rows, two of one kind one', () => {
		const ring = row('ring_of_resistance').effectiveId;
		const fire = addItemInstance([], ring, { choice: 'fire' });
		expect(addItemInstance(fire, ring, { choice: 'cold' })).toHaveLength(2);
		expect(addItemInstance(fire, ring, { choice: 'fire' })).toHaveLength(1);
	});

	it('"longsword +1" is the +N weapon built on a longsword, at +1', () => {
		const matches = instancesForQuery(scope, 'longsword +1');
		const longsword = matches.find((m) => m.name === 'Longsword +1');
		expect(longsword?.ref).toBe(row('weapon_1_2_or_3').effectiveId);
		expect(longsword?.answers).toEqual({ base: row('longsword').effectiveId, bonus: 1 });
	});

	it('"sword +2" is every sword at +2, and "shield+3" is the shield', () => {
		const swords = instancesForQuery(scope, 'sword +2').map((m) => m.name);
		expect(swords).toEqual(
			expect.arrayContaining(['Longsword +2', 'Shortsword +2', 'Greatsword +2']),
		);
		expect(instancesForQuery(scope, 'shield+3').map((m) => m.name)).toEqual(['Shield +3']);
	});

	it('only the rungs a row offers, and nothing for a bare bonus', () => {
		expect(instancesForQuery(scope, 'longsword +4')).toEqual([]);
		expect(instancesForQuery(scope, '+1')).toEqual([]);
		expect(instancesForQuery(scope, 'longsword')).toEqual([]);
	});

	it('a picker row id carries its answers there and back', () => {
		const [match] = instancesForQuery(scope, 'longsword +2');
		if (!match) throw new Error('no match');
		expect(parseInstanceRowId(instanceRowId(match))).toEqual({
			ref: match.ref,
			answers: match.answers,
		});
		expect(parseInstanceRowId(row('longsword').effectiveId)).toBeNull();
	});

	it('an answered instance is named for what it is; an unanswered one keeps its heading', () => {
		const weapon = row('weapon_1_2_or_3');
		const longsword = row('longsword').effectiveId;
		expect(instanceName({ graph, locale: 'en' }, weapon, { base: longsword, bonus: 2 })).toBe(
			'Longsword +2',
		);
		expect(instanceName({ graph, locale: 'en' }, row('shield_1_2_or_3'), { bonus: 1 })).toBe(
			'Shield +1',
		);
		expect(instanceName({ graph, locale: 'en' }, weapon, { base: longsword })).toBeUndefined();
	});

	it('a mundane item knows the +N row it can be found as', () => {
		expect(bonusRowFor(scope, row('longsword'))).toMatchObject({
			ref: row('weapon_1_2_or_3').effectiveId,
			usesBase: true,
		});
		expect(bonusRowFor(scope, row('shield'))).toMatchObject({
			ref: row('shield_1_2_or_3').effectiveId,
			usesBase: false,
		});
		expect(bonusRowFor(scope, row('arrows'))).toMatchObject({
			ref: row('ammunition_1_2_or_3').effectiveId,
			usesBase: true,
		});
		// a magic row is not a base, and gear has no +N version
		expect(bonusRowFor(scope, row('weapon_1_2_or_3'))).toBeNull();
		expect(bonusRowFor(scope, row('backpack'))).toBeNull();
	});

	it('two different instances are two rows; the same instance twice is one', () => {
		const ref = row('weapon_1_2_or_3').effectiveId;
		const base = row('longsword').effectiveId;
		const once = addItemInstance([], ref, { base, bonus: 1 });
		const again = addItemInstance(once, ref, { base, bonus: 1 });
		const other = addItemInstance(again, ref, { base, bonus: 2 });
		expect(again).toHaveLength(1);
		expect(other.map((e) => e.bonus)).toEqual([1, 2]);
	});
});
