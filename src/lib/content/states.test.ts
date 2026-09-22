/*
 * CONDEFF — conditions and runtime effects as ONE content type.
 *
 * What is worth pinning is not the merge itself but the four things it must not have cost: a pack
 * author's file keeps working untouched, the two kinds stay distinguishable, a slug that exists as
 * both keeps two identities, and a row written before the merge still says what it meant.
 */
import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { loadContent } from './loader';
import { migrateRows } from './migrations';
import { conditionRows, effectCatalogRows, valenceOf, isHarmful } from './states';
import { VALENCE } from './schemas';

const CONDITIONS = [
	'id,valence,max_level,effects,name_en',
	'poisoned,harmful,1,disadvantage:attack,Poisoned',
	'exhaustion,harmful,6,flat_bonus:d20_tests-2*exhaustion,Exhaustion',
].join('\n');

const EFFECTS = [
	'id,valence,duration_rounds,effects,name_en',
	'bless,helpful,10,flat_bonus:attack+1d4,Bless',
	'bane,harmful,10,flat_bonus:attack-1d4,Bane',
].join('\n');

const header = (extra = '') =>
	['#content-source: Test Pack', '#content-systems: 5e', extra].filter(Boolean).join('\n') + '\n';

async function load(files: Record<string, string>) {
	const s = new MemoryStorage();
	for (const [name, body] of Object.entries(files)) await s.write(`c/${name}`, body);
	return loadContent(s, ['c']);
}

describe('the merged state type', () => {
	it('reads a conditions file by its NAME, and marks its rows as conditions', async () => {
		const g = await load({
			'conditions_pack.csv': header() + CONDITIONS,
			'effects_pack.csv': header() + EFFECTS,
		});
		expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
		expect(conditionRows(g, '5e').map((r) => r.id)).toEqual(['poisoned', 'exhaustion']);
		expect(effectCatalogRows(g, '5e').map((r) => r.id)).toEqual(['bless', 'bane']);
	});

	it('reads a file that DECLARES the old type name the same way', async () => {
		const g = await load({
			'my_states.csv': header('#content-type: condition') + CONDITIONS,
		});
		expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
		expect(conditionRows(g, '5e').map((r) => r.id)).toEqual(['poisoned', 'exhaustion']);
	});

	it('keeps a row that says its own kind, whatever file it sits in', async () => {
		const g = await load({
			'conditions_pack.csv': header() + 'id,kind,valence,name_en\nhalf_cover,effect,helpful,Cover',
		});
		expect(conditionRows(g, '5e')).toEqual([]);
		expect(effectCatalogRows(g, '5e').map((r) => r.id)).toEqual(['half_cover']);
	});

	it('the KIND scopes the slug, so one id can be both a condition and a catalog entry', async () => {
		const g = await load({
			'conditions_pack.csv':
				header() + 'id,valence,effects,name_en\nrage,helpful,advantage:save.str,Rage',
			'effects_pack.csv':
				header() + 'id,valence,effects,name_en\nrage,helpful,apply_condition:rage,Rage',
		});
		expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
		const tokensOfRef = (ref: string) => {
			const row = g.get(ref);
			return row?.type === 'effect' ? row.data.effects : undefined;
		};
		expect(tokensOfRef('condition:Test Pack:rage')).toEqual(['advantage:save.str']);
		expect(tokensOfRef('effect:Test Pack:rage')).toEqual(['apply_condition:rage']);
	});

	it('a blank valence reads neutral rather than guessing a side', async () => {
		const g = await load({ 'effects_pack.csv': header() + 'id,name_en\nodd,Odd' });
		const row = effectCatalogRows(g, '5e')[0];
		expect(row && valenceOf(row)).toBe(VALENCE.neutral);
		expect(row && isHarmful(row)).toBe(false);
	});
});

describe('v2 → v3: `negative` becomes `valence`', () => {
	it('carries both values across, and drops the old column', () => {
		const { rows, error } = migrateRows(
			'effect',
			[
				{ id: 'bane', negative: 'true', name_en: 'Bane' },
				{ id: 'bless', negative: 'false', name_en: 'Bless' },
			],
			2,
		);
		expect(error).toBeUndefined();
		expect(rows).toEqual([
			{ id: 'bane', valence: 'harmful', name_en: 'Bane' },
			{ id: 'bless', valence: 'helpful', name_en: 'Bless' },
		]);
	});

	it('leaves a row that already carries a valence alone', () => {
		const { rows } = migrateRows(
			'effect',
			[{ id: 'x', negative: 'true', valence: 'neutral', name_en: 'X' }],
			2,
		);
		expect(rows[0]).toEqual({ id: 'x', valence: 'neutral', name_en: 'X' });
	});
});
