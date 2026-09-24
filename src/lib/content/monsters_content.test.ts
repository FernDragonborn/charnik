/*
 * The shipped MONSTER data, and the two holes BEAST-DATA closed.
 *
 * 1. `attacks` — every other combat number a creature has was a declared column, and its attacks
 *    lived only in `text_en`, which nothing in `src/` may read a value out of. A form that REPLACES
 *    your attacks (Wild Shape) has no other source, so the column is asserted here literally: a
 *    converter that stops filling it fails, instead of shipping a druid who cannot bite.
 * 2. The 2014 pack shipped 201 creatures and four beasts — SRD 5.1's two appendices, where every
 *    ordinary animal lives, had never been converted. A 2014 druid had no legal Wild Shape form at
 *    levels 2-7, which is most of the game.
 */
import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { loadContent } from './loader';
import { readPackFile } from '../../test-support/real-content';

const EDITIONS = [
	['5.5e', 'srd-2024'],
	['5e', 'srd-2014'],
] as const;

async function loadEdition(pack: string) {
	const s = new MemoryStorage();
	await s.write('c/monsters_srd.csv', readPackFile(pack, 'monsters_srd.csv'));
	return loadContent(s, ['c']);
}

/** `<name>:<+hit>:<reach|range>:<dice> <type>[, …]` — the grammar the shipped packs are written in. The
 *  last two fields may be empty: a roper's tendril hits and grapples and deals no damage, and an
 *  attack whose reach the source leaves unstated is still an attack. */
const ATTACK = /^[^:;]+:[+-]\d+:[^:;]*:[^:;]*$/;

describe('shipped monsters', () => {
	for (const [edition, pack] of EDITIONS) {
		describe(edition, () => {
			it('loads with no errors and no hash drift', async () => {
				const g = await loadEdition(pack);
				expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
				expect(g.driftItems).toEqual([]);
			});

			it('nearly every creature states its attacks, and each one parses', async () => {
				const g = await loadEdition(pack);
				const rows = g.list('monster');
				const withAttacks = rows.filter((r) => (r.data.attacks ?? '') !== '');
				// the handful without are the creatures that have no attack at all (a shrieker, a frog)
				expect(rows.length - withAttacks.length).toBeLessThanOrEqual(4);
				for (const row of withAttacks)
					for (const attack of (row.data.attacks ?? '').split(';'))
						expect(attack.trim(), `${row.id}: "${attack}"`).toMatch(ATTACK);
			});

			it('a wolf bites for what its own stat block says', async () => {
				const g = await loadEdition(pack);
				const wolf = g.list('monster').find((r) => r.id === 'wolf');
				// 5.1 "7 (2d4 + 2) piercing" · 5.2.1 "5 (1d6 + 2) Piercing"
				expect(wolf?.data.attacks).toBe(
					edition === '5e' ? 'Bite:+4:5 ft:2d4+2 piercing' : 'Bite:+4:5 ft:1d6+2 piercing',
				);
			});
		});
	}

	it('2014 carries the appendices, so a druid at level 2 has forms to take', async () => {
		const g = await loadEdition('srd-2014');
		const rows = g.list('monster');
		expect(rows).toHaveLength(317); // 201 chapter + 95 appendix MM-A + 21 MM-B
		const beasts = rows.filter((r) => r.data.creature_type.includes('beast'));
		const shapeable = beasts.filter((r) => ['0', '1/8', '1/4'].includes(r.data.cr ?? ''));
		// RAW a 2014 druid takes CR 1/4 at level 2; the pack used to offer exactly none
		expect(shapeable.length).toBeGreaterThan(30);
		expect(rows.map((r) => r.id)).toEqual(
			expect.arrayContaining(['wolf', 'giant_eagle', 'crocodile', 'brown_bear', 'veteran']),
		);
	});

	it('2014 states saves and damage defences, the columns only 2024 used to have', async () => {
		const g = await loadEdition('srd-2014');
		const byId = (id: string) => g.list('monster').find((r) => r.id === id);
		// SRD 5.1 Adult Red Dragon: "Saving Throws Dex +6, Con +13, Wis +7, Cha +11"
		expect(byId('adult_red_dragon')?.data.dex_save).toBe(6);
		expect(byId('adult_red_dragon')?.data.con_save).toBe(13);
		expect(byId('adult_red_dragon')?.data.immunities).toBe('fire');
		// "Damage Vulnerabilities fire · Damage Resistances bludgeoning, piercing"
		expect(byId('awakened_tree')?.data.vulnerabilities).toBe('fire');
		expect(byId('awakened_tree')?.data.resistances).toBe('bludgeoning, piercing');
	});
});
