import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { MemoryStorage } from '../storage/memory';
import { loadContent, type ContentGraph } from './loader';
import { newCharacter, characterSchema, type Character } from '../character/schema';
import { deriveSheet } from '../character/derive';

/*
 * Guards SHIPPED class-feature effect tokens (EFX-E4 authoring): a barbarian must derive the Rage
 * uses pool from `barbarian_rage`'s authored `grant_resource:rage:step(...)`. Pins the RAW use
 * counts per level in BOTH editions — including the 5.1-only `20->inf` → ∞ (the ∞-render case).
 * Reads the real content/ files, so a wiped/typo'd token fails here.
 */
async function loadEdition(dir: string): Promise<ContentGraph> {
	const s = new MemoryStorage();
	for (const f of readdirSync(`${process.cwd()}/${dir}`))
		if (f.endsWith('.csv')) await s.write(`c/${f}`, readFileSync(`${process.cwd()}/${dir}/${f}`, 'utf8'));
	return loadContent(s, ['c']);
}

function charOf(
	source: string,
	system: '5e' | '5.5e',
	classId: string,
	level: number
): Character {
	const c = newCharacter('grog', 'Grog', system);
	c.build.classes = [{ class: `class:${source}:${classId}`, level }];
	return characterSchema.parse(c);
}
const barbarian = (source: string, system: '5e' | '5.5e', level: number) =>
	charOf(source, system, 'barbarian', level);

function rollFormula(
	graph: ContentGraph,
	source: string,
	system: '5e' | '5.5e',
	classId: string,
	level: number,
	rollId: string
): string | undefined {
	const sheet = deriveSheet(charOf(source, system, classId, level), graph);
	return sheet.facts.rolls.find((r) => r.id === rollId)?.formula;
}

function rageMax(graph: ContentGraph, source: string, system: '5e' | '5.5e', level: number): number {
	const sheet = deriveSheet(barbarian(source, system, level), graph);
	return sheet.resources.find((r) => r.id === 'rage')?.max ?? -1;
}

describe('shipped class features · Rage resource (EFX-E4)', () => {
	it('5.5e (SRD 5.2.1): Rage uses step 1→2, 3→3, 6→4, 12→5, 17→6, capped at 6', async () => {
		const g = await loadEdition('content/srd-2024');
		expect(rageMax(g, 'SRD 5.2.1', '5.5e', 1)).toBe(2);
		expect(rageMax(g, 'SRD 5.2.1', '5.5e', 6)).toBe(4);
		expect(rageMax(g, 'SRD 5.2.1', '5.5e', 20)).toBe(6); // no unlimited in 2024
	});

	it('5e (SRD 5.1): same ladder but level 20 = Unlimited (∞)', async () => {
		const g = await loadEdition('content/srd-2014');
		expect(rageMax(g, 'SRD 5.1', '5e', 1)).toBe(2);
		expect(rageMax(g, 'SRD 5.1', '5e', 12)).toBe(5);
		expect(rageMax(g, 'SRD 5.1', '5e', 20)).toBe(Infinity); // 20->inf terminal
	});
});

describe('shipped feature rollables · grant_roll scaling dice (EFX-E4/ROLL)', () => {
	it('5.5e: Sneak Attack Nd6, Bardic Inspiration + Martial Arts dice scale by class level', async () => {
		const g = await loadEdition('content/srd-2024');
		expect(rollFormula(g, 'SRD 5.2.1', '5.5e', 'rogue', 6, 'sneak_attack')).toBe('3d6'); // ceil(6/2)
		expect(rollFormula(g, 'SRD 5.2.1', '5.5e', 'bard', 5, 'bardic_inspiration')).toBe('1d8');
		expect(rollFormula(g, 'SRD 5.2.1', '5.5e', 'monk', 11, 'martial_arts')).toBe('1d10'); // 2024: d6-start
	});

	it('5e: Martial Arts die starts a step lower than 2024 (d4 vs d6)', async () => {
		const g = await loadEdition('content/srd-2014');
		expect(rollFormula(g, 'SRD 5.1', '5e', 'rogue', 20, 'sneak_attack')).toBe('10d6');
		expect(rollFormula(g, 'SRD 5.1', '5e', 'monk', 1, 'martial_arts')).toBe('1d4'); // 2014: d4-start
		expect(rollFormula(g, 'SRD 5.1', '5e', 'monk', 11, 'martial_arts')).toBe('1d8');
	});
});

describe('shipped 2024 Exhaustion ladder (EFX-EXH)', () => {
	it('scales the d20-test penalty (−2×level) and speed (−5×level) off play.exhaustion', async () => {
		const g = await loadEdition('content/srd-2024');
		const at = (level: number) => {
			const c = barbarian('SRD 5.2.1', '5.5e', 5);
			c.play.exhaustion = level;
			return deriveSheet(characterSchema.parse(c), g);
		};
		const base = at(0);
		const ex3 = at(3);
		// exhaustion 3 → −6 on every d20 test (a save here) and −15 ft speed (RAW 2024)
		expect(ex3.abilities.con.save.value).toBe(base.abilities.con.save.value - 6);
		expect(ex3.skills.athletics.value).toBe(base.skills.athletics.value - 6);
		expect(ex3.speed.value).toBe(base.speed.value - 15);
	});
});
