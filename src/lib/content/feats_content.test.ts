import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { loadContent } from './loader';
import { featSpellGrants } from '../character/spellcasting';
import { splitList } from './schemas';
import { readPackFile } from '../../test-support/real-content';

/*
 * Guards the SHIPPED §D authoring — the feat columns that say a feat teaches spells, and the
 * background column that pins which list it teaches them from. Both are curated from the SRD text
 * after conversion, so a converter re-run that stops preserving them would silently empty the
 * feature rather than fail: these assertions are what makes that loud. Reads the real shipped files.
 */
async function loadPack(pack: string) {
	const s = new MemoryStorage();
	for (const file of ['feats_srd.csv', 'backgrounds_srd.csv', 'classes_srd.csv'])
		await s.write(`c/${file}`, readPackFile(pack, file));
	return loadContent(s, ['c']);
}

describe('shipped feats · the spell grant (§D)', () => {
	it('loads with no errors and no hash drift (the re-stamp is correct)', async () => {
		const g = await loadPack('srd-2024');
		expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
		expect(g.driftItems).toEqual([]);
	});

	it('Magic Initiate states its counts, its lists and its casting abilities', async () => {
		const g = await loadPack('srd-2024');
		const mi = g.list('feat').find((f) => f.id === 'magic_initiate');
		expect(mi, 'magic_initiate is shipped').toBeDefined();
		// two cantrips and one level-1 spell, exactly as the row's own text states
		expect(featSpellGrants(mi?.data.spell_choice)).toEqual([
			{ level: 0, count: 2 },
			{ level: 1, count: 1 },
		]);
		expect(splitList(mi?.data.spell_choice_lists)).toEqual(['cleric', 'druid', 'wizard']);
		expect(splitList(mi?.data.spell_choice_ability)).toEqual(['int', 'wis', 'cha']);
	});

	it('every list it names is a class that ships in the same pack', async () => {
		const g = await loadPack('srd-2024');
		const classIds = new Set(g.list('class').map((c) => c.id));
		for (const feat of g.list('feat'))
			for (const list of splitList(feat.data.spell_choice_lists))
				expect(classIds, `${feat.id} → ${list}`).toContain(list);
	});

	it('a feat that teaches spells says all three columns, or none of them', async () => {
		const g = await loadPack('srd-2024');
		for (const feat of g.list('feat')) {
			const said = [
				feat.data.spell_choice,
				feat.data.spell_choice_lists,
				feat.data.spell_choice_ability,
			];
			const filled = said.filter(Boolean).length;
			expect(filled === 0 || filled === 3, `${feat.id}: ${filled}/3 columns`).toBe(true);
		}
	});

	it('a background that grants it pins the list the SRD names', async () => {
		const g = await loadPack('srd-2024');
		const pinned = Object.fromEntries(
			g.list('background').map((b) => [b.id, b.data.origin_feat_spell_list ?? '']),
		);
		// "Magic Initiate (Cleric)" / "(Wizard)" in character-origins.md
		expect(pinned.acolyte).toBe('cleric');
		expect(pinned.sage).toBe('wizard');
		// a background whose feat names no list leaves it blank rather than guessing
		expect(pinned.criminal).toBe('');
		expect(pinned.soldier).toBe('');
	});

	it('a pinned list is one of the lists its feat offers', async () => {
		const g = await loadPack('srd-2024');
		const feats = new Map(g.list('feat').map((f) => [f.id, f]));
		for (const bg of g.list('background')) {
			const list = bg.data.origin_feat_spell_list;
			if (!list) continue;
			const offered = splitList(feats.get(String(bg.data.origin_feat))?.data.spell_choice_lists);
			expect(offered, `${bg.id} pins ${list}`).toContain(list);
		}
	});
});
