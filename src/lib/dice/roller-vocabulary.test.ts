import { describe, it, expect } from 'vitest';
import {
	candidateResolver,
	matchCandidates,
	rollerCandidates,
	type NamedRollSource,
} from './roller-vocabulary';
import { PILL_KIND, TOKEN_KIND } from './roller';
import { ADVANTAGE_MODE } from '$lib/rules/dice';

const SOURCES: NamedRollSource[] = [
	{
		key: 'bless',
		names: { en: 'Bless', uk: 'Благословення' },
		tokens: ['flat_bonus:attack+1d4', 'flat_bonus:saves+1d4'],
		active: true,
	},
	{
		key: 'bane',
		names: { en: 'Bane', uk: 'Благання' },
		tokens: ['flat_bonus:attack-1d4'],
		active: false,
	},
	{
		key: 'trickster_blessing',
		names: { en: 'Blessing of the Trickster' },
		tokens: ['advantage:skill.stealth'],
		active: true,
	},
	{
		key: 'shield_of_faith',
		names: { en: 'Shield of Faith' },
		tokens: ['flat_bonus:ac+2'],
		active: false,
	},
	{ key: 'inert', names: { en: 'Inert' }, tokens: ['note:nothing rollable here'], active: false },
	{ key: 'fire', names: { en: 'fire' }, tokens: [], active: false, damageType: true },
	{
		key: 'neutral',
		names: { en: 'neutral', uk: 'нейтрально' },
		tokens: [],
		active: false,
		mode: ADVANTAGE_MODE.neither,
	},
];

const en = () => rollerCandidates(SOURCES, 'en');
const uk = () => rollerCandidates(SOURCES, 'uk');
const byKey = (key: string) => en().find((c) => c.key === key);

describe('rollerCandidates', () => {
	it('writes the sign on both directions of the same die', () => {
		expect(byKey('bless')?.preview).toBe('+1d4');
		expect(byKey('bane')?.preview).toBe('−1d4');
	});

	it('inserts a die that carries its provenance, so the log says Bless and not "by hand"', () => {
		expect(byKey('bless')?.insert).toEqual({
			kind: TOKEN_KIND.pill,
			pill: { kind: PILL_KIND.dice, text: 'Bless', count: 1, sides: 4, sign: 1, source: 'Bless' },
		});
	});

	it('lets a source whose mechanic IS advantage insert the mode instead of a pill', () => {
		expect(byKey('trickster_blessing')?.insert).toEqual({
			kind: TOKEN_KIND.advantage,
			mode: ADVANTAGE_MODE.advantage,
		});
	});

	it('offers the mode words as rows of their own, named in full', () => {
		expect(byKey('neutral')?.insert).toEqual({
			kind: TOKEN_KIND.advantage,
			mode: ADVANTAGE_MODE.neither,
		});
		// no chip: the row's NAME is what it does, as with a damage type
		expect(byKey('neutral')?.preview).toBe('');
		// found by the name in ANY installed language, whatever language the UI is in
		expect(matchCandidates('нейтр', en())[0]?.candidate.key).toBe('neutral');
		expect(matchCandidates('neut', uk())[0]?.candidate.label).toBe('нейтрально');
	});

	it('writes out what an advantage-granting SOURCE does, not the app jargon for it', () => {
		expect(byKey('trickster_blessing')?.preview).toBe('advantage');
	});

	it('offers a flat source and a damage type in the same list', () => {
		expect(byKey('shield_of_faith')?.preview).toBe('+2');
		expect(byKey('fire')?.insert).toMatchObject({
			pill: { kind: PILL_KIND.damageType, type: 'fire' },
		});
		expect(byKey('fire')?.preview).toBe('');
	});

	it('drops a source that would insert nothing rather than offering a dead-end row', () => {
		expect(byKey('inert')).toBeUndefined();
	});

	it('labels in the INTERFACE locale, and falls back to English when untranslated', () => {
		const rows = uk();
		expect(rows.find((c) => c.key === 'bless')?.label).toBe('Благословення');
		expect(rows.find((c) => c.key === 'shield_of_faith')?.label).toBe('Shield of Faith');
	});
});

describe('matchCandidates', () => {
	it('finds a row by a name in a language the UI is not in', () => {
		// typed in Ukrainian, interface in English: the row is found, and shown as "Bless"
		const [hit] = matchCandidates('благосл', en());
		expect(hit?.candidate.label).toBe('Bless');
		// nothing to embolden — what was typed is not in the label that is being shown
		expect(hit?.at).toBe(-1);
	});

	it('finds a row by its key, so an untranslated row is still reachable', () => {
		expect(matchCandidates('shield_of', en())[0]?.candidate.key).toBe('shield_of_faith');
	});

	it('matches a word inside the name, not only its start', () => {
		expect(matchCandidates('tri', en()).map((m) => m.candidate.key)).toContain(
			'trickster_blessing',
		);
	});

	it('puts active effects above everything else', () => {
		// "бл" hits Благословення (active) and Благання (inactive) under an ENGLISH interface — the
		// order is decided by what is on the character, not by which language found the row
		const keys = matchCandidates('бл', en()).map((m) => m.candidate.key);
		expect(keys.indexOf('bless')).toBeLessThan(keys.indexOf('bane'));
	});

	it('reports where in the shown label the match sits, for the emboldening', () => {
		const [hit] = matchCandidates('bles', en());
		expect(hit?.at).toBe(0);
		expect(hit?.length).toBe(4);
	});

	it('is empty for an empty query — the menu opens on a letter, not on a caret', () => {
		expect(matchCandidates('  ', en())).toEqual([]);
	});
});

describe('candidateResolver', () => {
	it('resolves an exact name in any language to the same token', () => {
		const resolve = candidateResolver(en());
		expect(resolve('Благословення')).toEqual(resolve('bless'));
		expect(resolve('BLESS')).toMatchObject({ pill: { source: 'Bless' } });
	});

	it('does not complete a partial word — that is the menu’s business', () => {
		expect(candidateResolver(en())('bles')).toBeNull();
	});

	it('blocks on a name two candidates share rather than picking one', () => {
		const shared: NamedRollSource[] = [
			{ key: 'a', names: { en: 'Ray' }, tokens: ['flat_bonus:attack+1d4'], active: false },
			{ key: 'b', names: { en: 'Ray' }, tokens: ['flat_bonus:attack+1d6'], active: false },
		];
		// a blocking pill rather than `null`: null means "not a name", and on a DAMAGE line an unknown
		// word becomes a damage type — so an ambiguous effect would have silently typed the damage and
		// dropped the dice it was asked for
		expect(candidateResolver(rollerCandidates(shared, 'en'))('ray')).toEqual({
			kind: 'pill',
			pill: { kind: 'raw', text: 'ray', ambiguous: true },
		});
	});
});
