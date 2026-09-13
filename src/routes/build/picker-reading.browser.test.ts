/*
 * Reading an option and walking to one — the keyboard contract both pickers share (ui.md §5/§6).
 *
 * Browser, because the walk IS a `KeyboardEvent` and the reveal is a DOM scroll: driven from a
 * hand-rolled key object it would test a different function than the one the picker wires up.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PickerReading, type PickerReadingHost } from './picker-reading.svelte';

const IDS = ['spell:src:fire bolt', 'spell:src:mage hand', 'spell:src:shield'];
const key = (code: string) => new KeyboardEvent('keydown', { code, cancelable: true });

/** A picker whose host answers live, like the components' does — plus a record of what it was told.
 *  Plain state, not `$state`: a test file cannot hold runes, so anything reading a `$derived` off the
 *  class (`activeId`) gets its own picker rather than mutating one and reading again. */
function picker(over: Partial<PickerReadingHost> = {}) {
	const state = { previewId: null as string | null, taken: [] as string[], opened: 0 };
	const reading = new PickerReading(
		() => ({
			ids: IDS,
			previewId: state.previewId,
			onpreview: (id) => (state.previewId = id),
			onopen: () => (state.opened += 1),
			ontake: (id) => state.taken.push(id),
			...over,
		}),
		'p1',
	);
	return { state, reading };
}

describe('PickerReading — reading an option', () => {
	it('opens the card on the option, and the same option again puts it away', () => {
		const { state, reading } = picker();
		reading.read(IDS[0] ?? '');
		expect(reading.reading).toBe(true);
		expect(state.previewId).toBe(IDS[0]);
		expect(state.opened).toBe(1); // the hover teaser is told to stand down

		reading.read(IDS[0] ?? '');
		expect(reading.reading).toBe(false);
	});

	it('moves the open card to another option rather than closing', () => {
		const { state, reading } = picker();
		reading.read(IDS[0] ?? '');
		reading.read(IDS[1] ?? '');
		expect(reading.reading).toBe(true);
		expect(state.previewId).toBe(IDS[1]);
	});

	it('never commits anything on its own', () => {
		const { state, reading } = picker();
		reading.read(IDS[0] ?? '');
		expect(state.taken).toEqual([]);
	});

	it('points aria-activedescendant at the highlight', () => {
		const shown = picker({ ids: [IDS[0] ?? ''] });
		shown.state.previewId = IDS[0] ?? null;
		expect(shown.reading.activeId).toBe(shown.reading.optionId(IDS[0] ?? ''));
	});

	it('and at nothing when the highlight is not on screen', () => {
		// a filtered-out or collapsed row: a combobox must not name an option the list is not showing
		const hidden = picker({ ids: [IDS[0] ?? ''] });
		hidden.state.previewId = IDS[2] ?? null;
		expect(hidden.reading.activeId).toBeUndefined();
	});
});

describe('PickerReading — the walk from the search box', () => {
	it('arrows move the highlight and nothing else', () => {
		const { state, reading } = picker();
		expect(reading.fromSearch(key('ArrowDown'))).toBe(true);
		expect(state.previewId).toBe(IDS[0]);
		reading.fromSearch(key('ArrowDown'));
		expect(state.previewId).toBe(IDS[1]);
		reading.fromSearch(key('ArrowUp'));
		expect(state.previewId).toBe(IDS[0]);
		expect(state.taken).toEqual([]);
		expect(reading.reading).toBe(false); // walking is not reading
	});

	it('Enter reads the highlight, and a second Enter takes it', () => {
		const { state, reading } = picker();
		reading.fromSearch(key('ArrowDown'));
		reading.fromSearch(key('Enter'));
		expect(reading.reading).toBe(true);
		expect(state.taken).toEqual([]);
		reading.fromSearch(key('NumpadEnter')); // the same key to everyone but the keyboard
		expect(state.taken).toEqual([IDS[0]]);
	});

	it('a picker with nothing to read takes on the first Enter', () => {
		const taken: string[] = [];
		const { reading } = picker({ onenter: (id) => taken.push(id) });
		reading.fromSearch(key('ArrowDown'));
		reading.fromSearch(key('Enter'));
		expect(taken).toEqual([IDS[0]]);
		expect(reading.reading).toBe(false);
	});

	it('leaves Home and End to the caret', () => {
		const { state, reading } = picker();
		reading.fromSearch(key('ArrowDown'));
		expect(reading.fromSearch(key('End'))).toBe(false);
		expect(reading.fromSearch(key('Home'))).toBe(false);
		expect(state.previewId).toBe(IDS[0]); // the highlight did not jump
	});

	it('passes a key it does not own back to the box', () => {
		const { reading } = picker();
		expect(reading.fromSearch(key('KeyA'))).toBe(false);
	});
});

describe('PickerReading — the walk from an option that holds focus', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
	});

	it('hands the caret back to the search box, so the focus ring follows the highlight', () => {
		const { state, reading } = picker();
		const search = document.createElement('input');
		document.body.append(search);
		reading.search = search;

		reading.fromOptions(key('ArrowDown'));
		expect(state.previewId).toBe(IDS[0]);
		expect(document.activeElement).toBe(search);
	});

	it('jumps on Home/End there, where there is no caret to serve', () => {
		const { state, reading } = picker();
		reading.fromOptions(key('End'));
		expect(state.previewId).toBe(IDS[2]);
		reading.fromOptions(key('Home'));
		expect(state.previewId).toBe(IDS[0]);
	});

	it('leaves Enter to the focused button itself', () => {
		const { state, reading } = picker();
		state.previewId = IDS[0] ?? null;
		reading.fromOptions(key('Enter'));
		expect(reading.reading).toBe(false);
		expect(state.taken).toEqual([]);
	});

	it('…including on a host that HAS an onenter — the languages pane, where it mattered', () => {
		// a language has no article to read, so `LanguagesPane` supplies `onenter` for the walk from
		// the search box. Passed through to `fromOptions` it cancelled the focused chip's own click
		// and toggled the HIGHLIGHTED language instead — ui.md §5, "Enter is identical to a left click"
		const toggled: string[] = [];
		const { state, reading } = picker({ onenter: (id) => toggled.push(id) });
		state.previewId = IDS[0] ?? null;
		const event = key('Enter');
		reading.fromOptions(event);
		expect(toggled).toEqual([]);
		expect(event.defaultPrevented).toBe(false);
	});
});
