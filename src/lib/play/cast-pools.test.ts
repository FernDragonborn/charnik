import { beforeAll, describe, expect, it } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import {
	classRow,
	inventoryRow,
	newCharacter,
	characterSchema,
	type Character,
} from '$lib/character/schema';
import { buildSpellPicker } from '$lib/build/derive';
import { deriveSheet } from '$lib/character/derive';
import { spellEntries } from '$lib/character/spellcasting';
import type { ContentGraph } from '$lib/content/loader';
import { castSpell, poolAllowsSpell, spellcastingBlock } from './cast';
import { addEffect, removeEffects } from './effects';
import { rest } from './rests';
import type { PlayContext, PlayOutcome } from './outcome';

const editions = [
	{ system: '5e', source: 'SRD 5.1', pack: 'srd-2014' },
	{ system: '5.5e', source: 'SRD 5.2.1', pack: 'srd-2024' },
] as const;

describe.each(editions)(
	'declared cast pools and spellcasting blocks · $system',
	({ system, source, pack }) => {
		let graph: ContentGraph;
		const spell = (id: string) => 'spell:' + source + ':' + id;
		const derive = (character: Character) => deriveSheet(character, graph);
		const ctx: PlayContext = {
			derive,
			locale: 'en',
			get graph() {
				return graph;
			},
		};
		beforeAll(async () => {
			graph = await loadPacks(pack);
		});
		const caster = (): Character => {
			const character = newCharacter('casting_probe', 'Casting probe', system);
			character.build.classes = [classRow({ class: 'class:' + source + ':cleric', level: 5 })];
			character.play.hp.current = 20;
			character.play.effects = [
				{
					iid: 'pools',
					label: 'Authored pools',
					positive: true,
					effects: [
						'grant_resource:blessing:1:long:spell:bless',
						'grant_resource:unrelated:3:short',
					],
				},
			];
			return character;
		};
		const refusedWithoutEffects = (outcome: PlayOutcome, character: Character) => {
			expect(outcome.refused).toBe(true);
			expect(outcome.character).toBe(character);
			expect(outcome.asks ?? []).toEqual([]);
			expect(outcome.log).toEqual([]);
		};

		it('only a declared spell can spend the pool, and casting consumes no slot', () => {
			const character = caster();
			const outcome = castSpell(character, { spell: spell('bless'), pool: 'blessing' }, ctx);
			expect(outcome.refused).not.toBe(true);
			expect(outcome.character.play.resourcesSpent).toEqual({ blessing: 1 });
			expect(outcome.character.play.spellSlotsSpent).toEqual({});
			expect(outcome.asks?.[0]).toMatchObject({ slotLevel: 1 });
			const pool = derive(character).resources.find((entry) => entry.id === 'blessing');
			expect(pool && poolAllowsSpell(pool, { ref: spell('bless'), id: 'bless' })).toBe(true);
		});

		it.each([
			{ id: 'bless', pool: 'unrelated' },
			{ id: 'cure_wounds', pool: 'blessing' },
			{ id: 'magic_weapon', pool: 'unrelated' },
			{ id: 'light', pool: 'blessing' },
		])('refuses $pool for $id before any payment or prompt', ({ id, pool }) => {
			const character = caster();
			character.play.inCombat = true;
			refusedWithoutEffects(castSpell(character, { spell: spell(id), pool }, ctx), character);
			expect(character.play.resourcesSpent).toEqual({});
			expect(character.play.spellSlotsSpent).toEqual({});
		});

		it('a declaration may authorize several explicit spells but never a third', () => {
			const character = caster();
			character.play.effects = [
				{
					iid: 'item_pool',
					label: 'Authored item',
					positive: true,
					effects: ['grant_resource:charges:3:long:spell:bless,cure_wounds'],
				},
			];
			for (const id of ['bless', 'cure_wounds'])
				expect(castSpell(character, { spell: spell(id), pool: 'charges' }, ctx).refused).not.toBe(
					true,
				);
			refusedWithoutEffects(
				castSpell(character, { spell: spell('shield_of_faith'), pool: 'charges' }, ctx),
				character,
			);
		});

		it('an invalid pool is refused before the weapon choice a valid cast would ask', () => {
			const character = caster();
			character.build.inventory = ['longsword', 'dagger'].map((id) =>
				inventoryRow({
					iid: id,
					item: 'item:' + source + ':' + id,
					qty: 1,
					equipped: true,
					attuned: false,
				}),
			);
			expect(castSpell(character, { spell: spell('magic_weapon') }, ctx).asks).toContainEqual({
				kind: 'weapon',
				spell: spell('magic_weapon'),
			});
			refusedWithoutEffects(
				castSpell(character, { spell: spell('magic_weapon'), pool: 'unrelated' }, ctx),
				character,
			);
		});

		it('an exhausted linked pool refuses whole; short rests preserve it and long rests recharge it', () => {
			const used = castSpell(caster(), { spell: spell('bless'), pool: 'blessing' }, ctx).character;
			refusedWithoutEffects(
				castSpell(used, { spell: spell('bless'), pool: 'blessing' }, ctx),
				used,
			);
			const short = rest(used, { kind: 'short' }, ctx).character;
			expect(short.play.resourcesSpent.blessing).toBe(1);
			const long = rest(short, { kind: 'long' }, ctx).character;
			expect(long.play.resourcesSpent.blessing ?? 0).toBe(0);
			expect(castSpell(long, { spell: spell('bless'), pool: 'blessing' }, ctx).refused).not.toBe(
				true,
			);
		});

		it.each([
			{ id: 'bless', options: { slot: 1 } },
			{ id: 'bless', options: { pool: 'blessing' } },
			{ id: 'detect_magic', options: { ritual: true } },
			{ id: 'light', options: {} },
			{ id: 'magic_weapon', options: {} },
		])(
			'Rage blocks $id $options without any cost, roll, effect, or weapon question',
			({ id, options }) => {
				const character = addEffect(
					caster(),
					{ label: 'Rage', tokens: ['apply_condition:rage'], durationRounds: 0 },
					ctx,
				).character;
				character.play.inCombat = true;
				expect(derive(character).facts.spellcastingBlocks).not.toEqual([]);
				expect(spellcastingBlock(derive(character))).toMatchObject({
					key: 'combat.spells.stateBlocked',
				});
				refusedWithoutEffects(
					castSpell(character, { spell: spell(id), ...options }, ctx),
					character,
				);
			},
		);

		it('removing Rage restores casting without deleting known spells', () => {
			const character = caster();
			character.build.spells = [{ spell: spell('bless'), prepared: true, alwaysPrepared: false }];
			const raging = addEffect(
				character,
				{ label: 'Rage', tokens: ['apply_condition:rage'], durationRounds: 0 },
				ctx,
			).character;
			expect(spellEntries(raging, derive(raging)).map((entry) => entry.spell)).toContain(
				spell('bless'),
			);
			const rage = raging.play.effects.find((effect) => effect.label === 'Rage');
			expect(rage).toBeDefined();
			const calm = removeEffects(raging, rage ? [rage.iid] : [], ctx).character;
			expect(spellcastingBlock(derive(calm))).toBeNull();
			expect(castSpell(calm, { spell: spell('bless') }, ctx).refused).not.toBe(true);
		});
	},
);

describe('shipped Magic Initiate per-instance free casts', () => {
	let graph: ContentGraph;
	const source = 'SRD 5.2.1';
	const feat = 'feat:' + source + ':magic_initiate';
	const spell = (id: string) => 'spell:' + source + ':' + id;
	const derive = (character: Character) => deriveSheet(character, graph);
	const ctx: PlayContext = {
		derive,
		locale: 'en',
		get graph() {
			return graph;
		},
	};
	beforeAll(async () => {
		graph = await loadPacks('srd-2024');
	});
	const initiate = (): Character => {
		const character = newCharacter('initiate_probe', 'Initiate probe', '5.5e');
		character.play.hp.current = 20;
		character.build.classes = [classRow({ class: 'class:' + source + ':fighter', level: 8 })];
		character.build.feats = [feat, feat];
		character.build.featSpells = [
			{
				feat,
				key: 'origin',
				list: 'wizard',
				ability: 'int',
				spells: [spell('light'), spell('detect_magic')],
			},
			{
				feat,
				key: 'level_4',
				list: 'cleric',
				ability: 'wis',
				spells: [spell('light'), spell('detect_magic')],
			},
		];
		return character;
	};

	it('the shipped row declares a per-chosen-spell Long Rest pool', () => {
		const row = graph.get(feat);
		if (row?.type !== 'feat') throw new Error('The shipped feat must exist');
		expect(row.data.effects).toContain('grant_resource:magic_initiate:1:long:spell:chosen');
		const character = initiate();
		const pools = derive(character).resources.filter((pool) => pool.spell);
		expect(pools).toHaveLength(2);
		expect(new Set(pools.map((pool) => pool.id)).size).toBe(2);
		expect(pools.every((pool) => pool.spell === spell('detect_magic') && pool.max === 1)).toBe(
			true,
		);
		expect(spellEntries(character, derive(character))).toEqual([
			{ spell: spell('light'), prepared: true, alwaysPrepared: true },
			{ spell: spell('detect_magic'), prepared: true, alwaysPrepared: true },
		]);
	});

	it('repeatable instances spend and recharge separately, even when they choose the same spell', () => {
		const character = initiate();
		const [first, second] = derive(character).resources.filter((pool) => pool.spell);
		if (!first || !second) throw new Error('Both authored pools must exist');
		const used = castSpell(
			character,
			{ spell: spell('detect_magic'), pool: first.id },
			ctx,
		).character;
		expect(used.play.resourcesSpent).toEqual({ [first.id]: 1 });
		expect(castSpell(used, { spell: spell('detect_magic'), pool: first.id }, ctx).refused).toBe(
			true,
		);
		const both = castSpell(used, { spell: spell('detect_magic'), pool: second.id }, ctx).character;
		expect(both.play.resourcesSpent).toEqual({ [first.id]: 1, [second.id]: 1 });
		const restored = rest(both, { kind: 'long' }, ctx).character;
		expect(Object.values(restored.play.resourcesSpent).every((spent) => spent === 0)).toBe(true);
	});

	it('legacy saves keep their flat spell references and flags without guessing feat ownership', () => {
		const character = initiate();
		character.build.featSpells = character.build.featSpells.map(
			({ spells: _spells, ...choice }) => choice,
		);
		character.build.spells = [
			{ spell: spell('detect_magic'), prepared: false, alwaysPrepared: false },
		];
		const loaded = characterSchema.parse(character);
		const sheet = derive(loaded);
		expect(loaded.build.featSpells.every((choice) => choice.spells === undefined)).toBe(true);
		expect(spellEntries(loaded, sheet)).toEqual(character.build.spells);
		expect(sheet.resources.filter((pool) => pool.spell)).toEqual([]);
		expect(sheet.deriveIssues).toContainEqual(
			expect.objectContaining({ key: 'effectIssue.featSpellOwnershipMissing' }),
		);
		expect(characterSchema.parse(loaded).build.featSpells[0]?.spells).toBeUndefined();
	});

	it('a replacement spell keeps the spent use of its feat instance until the next Long Rest', () => {
		const character = initiate();
		const pool = derive(character).resources.find((entry) => entry.spell === spell('detect_magic'));
		if (!pool) throw new Error('The authored pool must exist');
		const used = castSpell(
			character,
			{ spell: spell('detect_magic'), pool: pool.id },
			ctx,
		).character;
		const choice = used.build.featSpells[0];
		if (!choice) throw new Error('The feat instance must exist');
		used.build.featSpells[0] = { ...choice, spells: [spell('shield')] };
		const replacement = derive(used).resources.find((entry) => entry.id === pool.id);
		expect(replacement?.spell).toBe(spell('shield'));
		expect(castSpell(used, { spell: spell('shield'), pool: pool.id }, ctx).refused).toBe(true);
	});

	it('class and feat choices count independently when both choose the same spell', () => {
		const character = initiate();
		character.build.classes = [classRow({ class: 'class:' + source + ':wizard', level: 8 })];
		character.build.spells = [
			{ spell: spell('detect_magic'), prepared: true, alwaysPrepared: false },
		];
		const sheet = derive(character);
		const picker = buildSpellPicker({
			allSpells: graph.list('spell', { system: character.system }),
			sheet,
			graph,
			strict: true,
			selectedSpells: character.build.spells.map((entry) => entry.spell),
		});
		expect(picker.map((entry) => entry.leveledChosen)).toEqual([1, 1, 1]);
		expect(
			spellEntries(character, sheet).filter((entry) => entry.spell === spell('detect_magic')),
		).toEqual([{ spell: spell('detect_magic'), prepared: true, alwaysPrepared: true }]);
	});

	it('the pool cannot cast another level-1 spell and is absent for an unanswered or removed feat', () => {
		const character = initiate();
		const pool = derive(character).resources.filter((pool) => pool.spell)[0];
		if (!pool) throw new Error('The authored pool must exist');
		expect(castSpell(character, { spell: spell('shield'), pool: pool.id }, ctx).refused).toBe(true);
		character.build.featSpells = character.build.featSpells.map((choice) => ({
			...choice,
			spells: [],
		}));
		expect(derive(character).resources.filter((pool) => pool.spell)).toEqual([]);
		const removed = initiate();
		removed.build.feats = [];
		expect(derive(removed).resources.filter((pool) => pool.spell)).toEqual([]);
		expect(spellEntries(removed, derive(removed))).toEqual([]);
	});
});
