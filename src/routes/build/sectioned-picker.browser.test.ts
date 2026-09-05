/*
 * The big picker's ARIA shape and its tab stops (ui.md ▸ the picker contract).
 *
 * Browser, because both are facts about the rendered tree: what a row IS, and which of the 1316
 * controls an open spell list renders are reachable by Tab. A `listbox` cannot express this picker —
 * a row carries two independent controls and `option` is Children-Presentational — so the invariant
 * worth freezing is that the grid stayed a grid and that `aria-activedescendant` names a GRIDCELL,
 * which is the one thing NVDA drops out of forms mode over (nvaccess/nvda#16414).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SectionedPicker from './blocks/SectionedPicker.svelte';
import { CONTENT_TYPES } from '$lib/content/schemas';
import type { LoadedRow } from '$lib/content/loader';
import { startI18n } from '$lib/i18n';

const SOURCE = 'SRD 5.2.1';

// the picker's own labels come from the catalog, and svelte-i18n throws rather than render a key
beforeAll(() => startI18n('en'));

/** A real spell row, through the real schema — a hand-built object would be a fake of the shape the
 *  picker reads (`rowName`, `pickerMeta`) rather than the shape the loader hands it. */
function spell(id: string, name: string, level: number): LoadedRow {
	return {
		type: 'spell',
		source: SOURCE,
		id,
		effectiveId: `spell:${SOURCE}:${id}`,
		systems: ['5.5e'],
		sourceLang: 'en',
		root: 'test',
		file: 'spells_srd.csv',
		data: CONTENT_TYPES.spell.schema.parse({
			id,
			name_en: name,
			level,
			school: 'evocation',
			casting_time: 'action',
			range: '120 ft',
			components: 'V S',
			duration: 'Instantaneous',
			concentration: 'false',
			ritual: 'false',
		}),
	};
}

const SECTIONS = [
	{ key: '1', label: 'Level 1', rows: [spell('burning_hands', 'Burning Hands', 1), spell('shield', 'Shield', 1)] },
	{ key: '2', label: 'Level 2', rows: [spell('shatter', 'Shatter', 2)] },
];

const picker = (over: { previewId?: string | null; takenIds?: string[] } = {}) =>
	render(SectionedPicker, {
		sections: SECTIONS,
		previewId: over.previewId ?? null,
		takenIds: over.takenIds ?? [],
		onpreview: () => {},
		ontake: () => {},
		detail: null,
		placeholder: 'search',
		// typing forces every section open, which is how a test reaches the rows without clicking —
		// and every fixture row carries an 'h', so nothing is filtered out on the way
		query: 'h',
	});

/** The rendered list, by the role it claims. */
const grid = () => document.querySelector('[role="grid"]');

describe('SectionedPicker — the list is a one-column grid', () => {
	it('declares a multi-selectable grid, not a listbox', async () => {
		await picker();
		expect(grid()?.getAttribute('aria-multiselectable')).toBe('true');
		expect(document.querySelector('[role="listbox"], [role="option"]')).toBeNull();
	});

	it('every child of the grid is a row, and a taken row says so', async () => {
		await picker({ takenIds: [`spell:${SOURCE}:shield`] });
		const children = [...(grid()?.children ?? [])];
		expect(children.length).toBeGreaterThan(0);
		expect(children.every((el) => el.getAttribute('role') === 'row')).toBe(true);
		// a section header's row carries the expanded state; an option's carries the selection
		expect(document.querySelectorAll('[role="row"][aria-expanded="true"]').length).toBe(2);
		expect(
			[...document.querySelectorAll('[role="row"][aria-selected="true"]')].map((el) =>
				el.getAttribute('data-entry'),
			),
		).toEqual([`spell:${SOURCE}:shield`]);
	});

	it('aria-activedescendant names a GRIDCELL, never a row or a button', async () => {
		const previewId = `spell:${SOURCE}:shatter`;
		await picker({ previewId });
		const active = document.querySelector('[aria-activedescendant]')?.getAttribute('aria-activedescendant');
		expect(active).toBeTruthy();
		expect(document.getElementById(active ?? '')?.getAttribute('role')).toBe('gridcell');
	});
});

describe('SectionedPicker — one row holds the tab stops', () => {
	/** The controls Tab can actually reach inside the list. */
	const tabbable = () => [...(grid()?.querySelectorAll('button:not([tabindex="-1"])') ?? [])];

	it('gives the highlighted row both of its controls and every other row none', async () => {
		const previewId = `spell:${SOURCE}:shatter`;
		await picker({ previewId });
		const cell = document.getElementById(
			document.querySelector('[aria-activedescendant]')?.getAttribute('aria-activedescendant') ?? '',
		);
		// the section headers stay their own tab stops: collapsing a section by keyboard is otherwise
		// unreachable, since the jump rail only ever expands
		const rows = tabbable().filter((el) => !el.classList.contains('sect'));
		expect(rows.length).toBe(2);
		expect(rows.every((el) => cell?.contains(el))).toBe(true);
	});

	it('falls back to the first row when nothing is highlighted, so the list can be entered at all', async () => {
		await picker({ previewId: null });
		const first = document.querySelector('[role="row"][data-entry]');
		const rows = tabbable().filter((el) => !el.classList.contains('sect'));
		expect(rows.length).toBe(2);
		expect(rows.every((el) => first?.contains(el))).toBe(true);
	});
});
