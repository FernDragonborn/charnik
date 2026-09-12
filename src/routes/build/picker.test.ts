/*
 * The picker's two headless pieces: the meta line an entry carries, and the keyboard walk over a
 * list of options. Both are pure, and both are what breaks silently — a cell losing its meta looks
 * like an empty cell, and a broken walk looks like a list that "just doesn't do arrows".
 */
import { describe, it, expect } from 'vitest';
import { type LoadedRow } from '$lib/content/loader';
import { pickerMeta } from './rows';
import { walkOptions } from '$lib/util/option-walk';
import { makeTempContentRoot } from '../../test-support/fixtures';

const S = 'SRD 5.2.1';
/** Stands in for `$_`: renders the key plus its values, so a test can see WHICH string was asked for
 *  without depending on the English wording. */
// the stand-in catalog: a key echoes itself with its values, so an assertion can see WHICH catalog a
// value was spelled in — the point of every expectation below
const t = (key: string, options?: { values?: Record<string, string | number> }) =>
	`${key}(${Object.values(options?.values ?? {}).join('|')})`;

async function rows(): Promise<Map<string, LoadedRow>> {
	const graph = await makeTempContentRoot({
		'classes_srd.csv': [
			'id,systems,source,name_en,hit_die,saves,caster,spell_ability',
			`wizard,5.5e,${S},Wizard,d6,"int,wis",full,int`,
		].join('\n'),
		'species_srd.csv': ['id,systems,source,name_en,size,speed', `dwarf,5.5e,${S},Dwarf,medium,30`].join('\n'),
		'backgrounds_srd.csv': ['id,systems,source,name_en,skills', `sage,5.5e,${S},Sage,"arcana,sleight_of_hand"`].join('\n'),
		'feats_srd.csv': ['id,systems,source,name_en,category', `archery,5.5e,${S},Archery,fighting_style`].join('\n'),
		'items_srd.csv': ['id,systems,source,name_en,category,rarity', `bag,5.5e,${S},Bag of Holding,wondrous,very_rare`].join('\n'),
	});
	expect(graph.issues.filter((i) => i.level === 'error')).toEqual([]);
	const types = ['class', 'species', 'background', 'feat', 'item'] as const;
	return new Map(types.flatMap((type) => graph.list(type).map((r) => [r.id, r] as const)));
}

describe('pickerMeta · every value comes from a declared column', () => {
	it('says what each type is actually chosen on', async () => {
		const all = await rows();
		const meta = (id: string) => {
			const row = all.get(id);
			if (!row) throw new Error(`fixture row missing: ${id}`);
			return pickerMeta(row, t);
		};

		// the saves name the `abilityShort` catalog too: "STR" is not the word every locale uses
		expect(meta('wizard')).toBe('d6 · abilityShort.int(), abilityShort.wis()');
		// the sheet's own origin sentence, so a species reads the same in both places
		// …including its metric conversion, which is the shared helper's and not a local 0.3
		expect(meta('dwarf')).toBe('build.origin.speciesMeta(creatureSize.medium()|30|9.1 m)');
		// every one of these columns is an open enum whose values are CONTENT, so each names the
		// catalog it is spelled in rather than being title-cased into English on the way out
		expect(meta('sage')).toBe('skillName.arcana(), skillName.sleight_of_hand()');
		expect(meta('archery')).toBe('featCategory.fighting_style()');
		// the item list is grouped BY category, so only the rarity is left to say
		expect(meta('bag')).toBe('itemRarity.very_rare()');
	});
});

describe('walkOptions · arrows highlight, Enter acts', () => {
	const ids = ['a', 'b', 'c'];
	/** One key press against a walk; returns what it previewed / entered. */
	function press(code: string, previewId: string | null) {
		const seen: { preview?: string; enter?: string } = {};
		const event = { code, preventDefault: () => {} };
		const handled = walkOptions(event, {
			ids,
			previewId,
			onpreview: (id) => (seen.preview = id),
			onenter: (id) => (seen.enter = id),
		});
		return { ...seen, handled };
	}

	it('moves the highlight and never commits on the way', () => {
		expect(press('ArrowDown', null)).toEqual({ preview: 'a', handled: true });
		expect(press('ArrowDown', 'a')).toEqual({ preview: 'b', handled: true });
		expect(press('ArrowUp', 'b')).toEqual({ preview: 'a', handled: true });
		expect(press('End', 'a')).toEqual({ preview: 'c', handled: true });
		expect(press('Home', 'c')).toEqual({ preview: 'a', handled: true });
	});

	it('stops at both ends instead of wrapping', () => {
		expect(press('ArrowUp', 'a')).toEqual({ preview: 'a', handled: true });
		expect(press('ArrowDown', 'c')).toEqual({ preview: 'c', handled: true });
	});

	it('Enter is a left click on the highlight, and nothing without one', () => {
		expect(press('Enter', 'b')).toEqual({ enter: 'b', handled: true });
		expect(press('Enter', null)).toEqual({ handled: false });
		// a highlight left behind on a row that is no longer rendered (a section was collapsed)
		expect(press('Enter', 'gone')).toEqual({ handled: false });
	});

	it('leaves keys that are not its own alone', () => {
		expect(press('KeyA', 'a')).toEqual({ handled: false });
		expect(walkOptions({ code: 'ArrowDown', preventDefault: () => {} }, {
			ids: [],
			previewId: null,
			onpreview: () => expect.fail('an empty list has nothing to walk'),
			onenter: () => expect.fail('an empty list has nothing to enter'),
		})).toBe(false);
	});
});
