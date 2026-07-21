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

function barbarian(source: string, system: '5e' | '5.5e', level: number): Character {
	const c = newCharacter('grog', 'Grog', system);
	c.build.classes = [{ class: `class:${source}:barbarian`, level }];
	return characterSchema.parse(c);
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
