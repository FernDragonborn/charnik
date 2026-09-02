/*
 * Where a picker's floating card lands. Browser, not node: every input here is a real viewport
 * measurement — the card's own height, the picker's rect, the writing direction — and a fake that
 * answers them is a fake of the thing under test.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { placeCard, entryElement } from './card-placement';

const GAP = 14;
const MARGIN = 12;
const RISE = 10;
// small enough that a picker, a card and the gap between them all fit the test viewport
const CARD_WIDTH = 100;
const PICKER_WIDTH = 120;
const ENTRY_REF = 'spell:SRD 5.2.1:fire bolt';

function scene({
	pickerLeft,
	entryTop = 300,
	rtl = false,
}: {
	pickerLeft: number;
	entryTop?: number;
	rtl?: boolean;
}) {
	const box = (styles: Partial<CSSStyleDeclaration>) => {
		const el = document.createElement('div');
		Object.assign(el.style, { position: 'fixed', ...styles });
		return el;
	};
	const picker = box({
		left: `${pickerLeft}px`,
		top: '100px',
		width: `${PICKER_WIDTH}px`,
		height: '400px',
		direction: rtl ? 'rtl' : 'ltr',
	});
	const entry = box({ left: `${pickerLeft}px`, top: `${entryTop}px`, width: '80px', height: '20px' });
	entry.dataset.entry = ENTRY_REF;
	picker.append(entry);
	const card = box({ width: `${CARD_WIDTH}px`, height: '100px' });
	document.body.append(picker, card);
	return { picker, entry, card };
}

describe('placeCard', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
	});

	it('puts the card on the sheet side of the picker, a gap away', () => {
		const { picker, entry, card } = scene({ pickerLeft: 140 });
		placeCard(card, entry, picker);
		expect(card.getBoundingClientRect().right).toBe(picker.getBoundingClientRect().left - GAP);
	});

	it('flips to the other side rather than hanging off-screen', () => {
		const { picker, entry, card } = scene({ pickerLeft: 20 }); // no room before it
		placeCard(card, entry, picker);
		expect(card.getBoundingClientRect().left).toBe(picker.getBoundingClientRect().right + GAP);
	});

	it('mirrors with the writing direction', () => {
		const { picker, entry, card } = scene({ pickerLeft: 140, rtl: true });
		placeCard(card, entry, picker);
		// RTL puts the sheet after the picker, and there is room for it there
		expect(card.getBoundingClientRect().left).toBe(picker.getBoundingClientRect().right + GAP);
	});

	it('sits level with the entry, just above it', () => {
		const { picker, entry, card } = scene({ pickerLeft: 140, entryTop: 300 });
		placeCard(card, entry, picker);
		expect(card.style.top).toBe(`${300 - RISE}px`);
	});

	it('never leaves the viewport, top or bottom', () => {
		const high = scene({ pickerLeft: 140, entryTop: 2 });
		placeCard(high.card, high.entry, high.picker);
		expect(high.card.style.top).toBe(`${MARGIN}px`);

		document.body.innerHTML = '';
		const low = scene({ pickerLeft: 140, entryTop: window.innerHeight - 5 });
		placeCard(low.card, low.entry, low.picker);
		expect(Number.parseInt(low.card.style.top, 10) + low.card.getBoundingClientRect().height).
			toBeLessThanOrEqual(window.innerHeight - MARGIN);
	});

	it('caps its height to the viewport, so a long article scrolls inside it', () => {
		const { picker, entry, card } = scene({ pickerLeft: 140 });
		placeCard(card, entry, picker);
		expect(card.style.maxHeight).toBe(`${window.innerHeight - MARGIN * 2}px`);
	});
});

describe('entryElement', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
	});

	it('finds the row by a ref that carries spaces and colons', () => {
		const { picker, entry } = scene({ pickerLeft: 140 });
		expect(entryElement(picker, ENTRY_REF)).toBe(entry);
	});

	it('falls back to the picker when that row is not rendered', () => {
		// a collapsed section or a filtered-out row: the card still has to land somewhere
		const { picker } = scene({ pickerLeft: 140 });
		expect(entryElement(picker, 'spell:SRD 5.2.1:wish')).toBe(picker);
	});
});
