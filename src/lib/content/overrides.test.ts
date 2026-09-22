import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import {
	overrides,
	overridesFromJson,
	serializeOverrides,
	withOverride,
	OVERRIDE_SCOPE,
	type OverrideMap,
} from './overrides.svelte';

/*
 * The player's own words (OWN-WORDS). Two things are worth pinning: a row is never in BOTH scopes,
 * so promoting cannot leave two answers to "what does this say"; and an empty write is the RESTORE,
 * which is the way back the feature would be a one-way door without.
 */
const ID = 'item:SRD 5.2.1:longsword';

describe('withOverride', () => {
	it('adds, replaces and removes without touching the map it was given', () => {
		const first = withOverride({}, ID, 'en', 'A blade my father carried.');
		expect(first[ID]).toEqual({ en: 'A blade my father carried.' });

		const second = withOverride(first, ID, 'uk', 'Батьків клинок.');
		expect(second[ID]).toEqual({ en: 'A blade my father carried.', uk: 'Батьків клинок.' });
		expect(first[ID]).toEqual({ en: 'A blade my father carried.' }); // the input is untouched

		// clearing the last locale takes the row out entirely, rather than leaving an empty husk
		const gone = withOverride(withOverride(second, ID, 'uk', ''), ID, 'en', '   ');
		expect(gone).toEqual({});
	});
});

describe('the overrides file', () => {
	it('round-trips through its tagged JSON', () => {
		const map: OverrideMap = { [ID]: { en: 'Mine.' } };
		expect(overridesFromJson(JSON.parse(serializeOverrides(map)))).toEqual(map);
	});

	it('an untrusted file yields only what has the right shape', () => {
		expect(overridesFromJson(null)).toEqual({});
		expect(overridesFromJson({ entries: { [ID]: { en: 'x' } } })).toEqual({}); // untagged
		expect(
			overridesFromJson({
				format: 'charnik-overrides',
				entries: { [ID]: { en: 'keep', uk: 42, ru: '   ' }, bad: 'not an object' },
			}),
		).toEqual({ [ID]: { en: 'keep' } });
	});
});

describe('the two scopes', () => {
	let written: OverrideMap;
	const bindCharacter = () => {
		written = {};
		overrides.bindCharacter({
			get entries() {
				return written;
			},
			write: (entries) => (written = entries),
		});
	};

	beforeEach(async () => {
		overrides.bindCharacter(null);
		await overrides.load(new MemoryStorage()); // an empty install scope
	});

	it('with no character open, words go install-wide', () => {
		overrides.write(ID, 'en', 'Everywhere.', OVERRIDE_SCOPE.character); // asked for, impossible
		expect(overrides.scopeOf(ID, 'en')).toBe(OVERRIDE_SCOPE.install);
		expect(overrides.textFor(ID, 'en')).toBe('Everywhere.');
	});

	it('a character reads their own words over the install-wide ones', () => {
		overrides.write(ID, 'en', 'Everyone reads this.', OVERRIDE_SCOPE.install);
		bindCharacter();
		expect(overrides.textFor(ID, 'en')).toBe('Everyone reads this.');

		overrides.write(ID, 'en', 'Only mine.', OVERRIDE_SCOPE.character);
		expect(overrides.textFor(ID, 'en')).toBe('Only mine.');
		expect(overrides.scopeOf(ID, 'en')).toBe(OVERRIDE_SCOPE.character);
		// …and the install copy is GONE, not shadowed: one row, one answer
		expect(overrides.installEntries[ID]).toBeUndefined();
	});

	it('promoting moves the row rather than copying it', () => {
		bindCharacter();
		overrides.write(ID, 'en', 'Mine.', OVERRIDE_SCOPE.character);
		overrides.write(ID, 'en', 'Mine.', OVERRIDE_SCOPE.install);
		expect(overrides.scopeOf(ID, 'en')).toBe(OVERRIDE_SCOPE.install);
		expect(written[ID]).toBeUndefined();
	});

	it('restore takes the words out of both scopes, in that locale only', () => {
		bindCharacter();
		overrides.write(ID, 'uk', 'Мій клинок.', OVERRIDE_SCOPE.character);
		overrides.write(ID, 'en', 'Everyone.', OVERRIDE_SCOPE.install);

		overrides.restore(ID, 'en');
		expect(overrides.textFor(ID, 'en')).toBeUndefined();
		// prose written in another language is not a translation of the one just restored
		expect(overrides.textFor(ID, 'uk')).toBe('Мій клинок.');
	});

	it('prose is scoped to the locale it was written in', () => {
		overrides.write(ID, 'uk', 'Батьків клинок.', OVERRIDE_SCOPE.install);
		expect(overrides.textFor(ID, 'uk')).toBe('Батьків клинок.');
		expect(overrides.textFor(ID, 'en')).toBeUndefined();
	});

	it('the install scope survives a write and a reload of the file', async () => {
		const storage = new MemoryStorage();
		overrides.write(ID, 'en', 'Promoted.', OVERRIDE_SCOPE.install);
		await overrides.save(storage);
		await overrides.load(storage);
		expect(overrides.textFor(ID, 'en')).toBe('Promoted.');
	});
});
