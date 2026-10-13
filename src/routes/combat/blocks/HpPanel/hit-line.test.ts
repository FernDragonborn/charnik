import { describe, it, expect } from 'vitest';
import { rollerCandidates, type NamedRollSource } from '$lib/dice/roller-vocabulary';
import { completionOf, readTypedHit, typeRows } from './hit-line';

const type = (key: string, uk: string): NamedRollSource => ({
	key,
	names: { en: key[0]?.toUpperCase() + key.slice(1), uk },
	tokens: [],
	active: false,
	damageType: true,
});
const candidates = rollerCandidates(
	[
		type('slashing', 'рубляча'),
		type('fire', 'вогонь'),
		type('force', 'силова'),
		type('cold', 'холод'),
	],
	'en',
);
const ORDER = ['fire', 'cold', 'force', 'slashing'];
const menu = (defended: string[] = []) => ({
	candidates,
	order: ORDER,
	defended: new Set(defended),
	untyped: 'untyped',
});
const keys = (word: string, defended: string[] = []) =>
	typeRows(word, menu(defended)).map((row) => row.key);

describe('the hit line · what is typed', () => {
	it('reads an amount, then the start of a type after it', () => {
		expect(readTypedHit('12')).toEqual({ amount: 12, word: '' });
		expect(readTypedHit('12 fi')).toEqual({ amount: 12, word: 'fi' });
		expect(readTypedHit(' 7fire ')).toEqual({ amount: 7, word: 'fire' });
	});

	it('has no amount while only a word is typed', () => {
		expect(readTypedHit('fi')).toEqual({ amount: null, word: 'fi' });
		expect(readTypedHit('')).toEqual({ amount: null, word: '' });
	});
});

describe('the hit line · the type menu', () => {
	it('with nothing typed lists every type in the order given, and the way back out last', () => {
		expect(keys('')).toEqual([...ORDER, null]);
	});

	it('a typed word finds types by name, and never offers "untyped"', () => {
		expect(keys('f')).toEqual(['fire', 'force']);
		expect(keys('zz')).toEqual([]);
	});

	it('a type the sheet defends leads the types that only match', () => {
		expect(keys('f', ['force'])).toEqual(['force', 'fire']);
	});

	it('finds a type by its name in another language, with nothing to embolden', () => {
		const [row] = typeRows('сил', menu());
		expect(row).toMatchObject({ key: 'force', at: -1 });
	});

	it('completes only a word that starts the first row’s name', () => {
		expect(completionOf('fi', typeRows('fi', menu()))).toBe('re');
		expect(completionOf('сил', typeRows('сил', menu()))).toBe('');
		expect(completionOf('', typeRows('', menu()))).toBe('');
	});
});
