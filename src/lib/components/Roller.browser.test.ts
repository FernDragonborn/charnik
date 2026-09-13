import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import Roller from './Roller.svelte';
import { DiceTray } from '$lib/dice/dice-tray.svelte';
import { rollerCandidates, type NamedRollSource } from '$lib/dice/roller-vocabulary';
import { PILL_KIND, ROLLER_ROLE } from '$lib/dice/roller';
import { startI18n, locale, waitLocale } from '$lib/i18n';

/*
 * The tray's KEYBOARD, in a real browser — the half of the design that unit tests can't reach,
 * because it is about what a keypress does to a caret, a menu and a pill. The model beneath is
 * covered in `dice/roller*.test.ts`; these assert that the wiring above it actually fires.
 */
// the dice tray's own chrome (the Roll button, the pill hints) reads from the catalog
beforeAll(async () => {
	await startI18n('en');
	void locale.set('en');
	await waitLocale();
});

const SOURCES: NamedRollSource[] = [
	{
		key: 'bless',
		names: { en: 'Bless', uk: 'Благословення' },
		tokens: ['flat_bonus:attack+1d4'],
		active: true,
	},
	{ key: 'bane', names: { en: 'Bane' }, tokens: ['flat_bonus:attack-1d4'], active: false },
	{ key: 'fire', names: { en: 'fire' }, tokens: [], active: false, damageType: true },
];

async function mount() {
	const diceTray = new DiceTray();
	diceTray.candidates = rollerCandidates(SOURCES, 'en');
	const onroll = vi.fn();
	const screen = await render(Roller, { diceTray, onroll });
	const caret = (line = 0) => document.querySelectorAll<HTMLInputElement>('.roller-input')[line];
	return { diceTray, onroll, screen, caret };
}

/** Type into a line, starting from its caret. */
async function typeInto(input: Element | undefined, text: string) {
	await userEvent.click(input as Element);
	await userEvent.keyboard(text);
}

describe('the dice tray (browser)', () => {
	it('parses a token on the space after it, and the pill carries the number', async () => {
		const { diceTray, caret } = await mount();
		await typeInto(caret(), '2d6 +3 ');
		expect(diceTray.lines[0]?.pills.map((p) => p.kind)).toEqual([PILL_KIND.dice, PILL_KIND.flat]);
		expect(document.querySelectorAll('.roller-pill')).toHaveLength(2);
	});

	it('opens the menu on a letter and Tab takes the highlighted row', async () => {
		const { diceTray, caret } = await mount();
		await typeInto(caret(), 'bl');
		expect(document.querySelector('.roller-menu')).not.toBeNull();
		await userEvent.keyboard('{Tab}');
		// the die arrives WITH its provenance — the whole point of picking a name over typing 1d4
		expect(diceTray.lines[0]?.pills[0]).toMatchObject({ sides: 4, source: 'Bless' });
		expect(document.querySelector('.roller-menu')).toBeNull();
	});

	it('moves the caret into the menu and back out of its top row', async () => {
		const { diceTray, caret } = await mount();
		// ONE match, so the row ↓ enters on is the top row: with several, ↓ steps past the top one
		// (which already reads as selected — it is what the ghost previews) and ↑ walks back through it
		await typeInto(caret(), 'bles');
		expect(diceTray.inMenu).toBe(false);
		await userEvent.keyboard('{ArrowDown}');
		expect(diceTray.inMenu).toBe(true);
		await userEvent.keyboard('{ArrowUp}');
		expect(diceTray.inMenu).toBe(false);
	});

	it('↓ and ↑ step between the LINES when no menu is open', async () => {
		const { screen, caret } = await mount();
		await screen.getByRole('button', { name: /damage line/ }).click();
		await userEvent.click(caret(0) as Element);
		await userEvent.keyboard('{ArrowDown}');
		expect(document.activeElement).toBe(caret(1));
		await userEvent.keyboard('{ArrowUp}');
		expect(document.activeElement).toBe(caret(0));
		// the top line's ↑ has nowhere to go and stays put, rather than dropping focus out of the tray
		await userEvent.keyboard('{ArrowUp}');
		expect(document.activeElement).toBe(caret(0));
	});

	it('Escape closes the menu and leaves the text where it was', async () => {
		const { diceTray, caret } = await mount();
		await typeInto(caret(), 'bl{Escape}');
		expect(document.querySelector('.roller-menu')).toBeNull();
		expect(diceTray.draft).toBe('bl');
	});

	it('Backspace at the left edge unfolds the last pill back into text', async () => {
		const { diceTray, caret } = await mount();
		await typeInto(caret(), '2d6 {Backspace}');
		expect(diceTray.lines[0]?.pills).toHaveLength(0);
		expect(diceTray.draft).toBe('2d6');
	});

	it('Ctrl+Enter rolls from inside a line, committing what was half-typed', async () => {
		const { onroll, caret } = await mount();
		await typeInto(caret(), 'd20 +7');
		// dispatched rather than pressed: the browser driver's modifier syntax doesn't reach the
		// element's own keydown, and what is under test is the handler's contract, not the driver's
		caret()?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
		);
		expect(onroll).toHaveBeenCalledOnce();
		const [entries] = onroll.mock.calls[0] as [{ mod: number }[]];
		expect(entries[0]?.mod).toBe(7);
	});

	it('holds the roll on a fragment it cannot account for, and says so', async () => {
		const { onroll, screen, caret } = await mount();
		await typeInto(caret(), '1d8 +d4? ');
		await expect.element(screen.getByRole('button', { name: 'Roll' })).toHaveClass(/muted/);
		expect(document.querySelector('.roller-blocked')).not.toBeNull();
		await screen.getByRole('button', { name: 'Roll' }).click();
		expect(onroll).not.toHaveBeenCalled();
	});

	it('a finished formula with no trailing space still rolls from the MOUSE', async () => {
		// the button used to be `disabled` here, and a disabled button takes no pointer events and
		// moves no focus — so the blur that commits `2d6` never fired and no number of clicks helped
		const { onroll, screen, caret } = await mount();
		await typeInto(caret(), '2d6');
		await screen.getByRole('button', { name: 'Roll' }).click();
		expect(onroll).toHaveBeenCalledOnce();
	});

	it('underlines damage with no type, and rolls it anyway', async () => {
		const { onroll, screen, caret } = await mount();
		await userEvent.click(screen.getByRole('button', { name: '+ damage line' }).element());
		await typeInto(caret(1), '2d6 +3 ');
		expect(document.querySelector('.roller-group.untyped')).not.toBeNull();
		// the underline has to SAY what it means — a wavy line nobody can read is not a message
		expect(document.querySelector('.roller-blocked.warn')?.textContent).toContain('no type');
		await userEvent.click(screen.getByRole('button', { name: 'Roll' }).element());
		expect(onroll).toHaveBeenCalledOnce();
		// naming a type takes the underline away
		await typeInto(caret(1), 'fire ');
		expect(document.querySelector('.roller-group.untyped')).toBeNull();
		expect(document.querySelector('.roller-blocked')).toBeNull();
	});

	it('leaving the line parses what was half-typed in it', async () => {
		const { diceTray, screen, caret } = await mount();
		await userEvent.click(screen.getByRole('button', { name: '+ damage line' }).element());
		await typeInto(caret(), '2d6 +3');
		await userEvent.click(caret(1) as Element);
		expect(diceTray.lines[0]?.pills.map((p) => p.kind)).toEqual([PILL_KIND.dice, PILL_KIND.flat]);
		expect(diceTray.drafts[0]).toBe('');
	});

	it('← at the left edge steps into the token before the caret', async () => {
		const { diceTray, caret } = await mount();
		await typeInto(caret(), 'd20 +7 ');
		await userEvent.keyboard('{ArrowLeft}');
		expect(diceTray.draft).toBe('+7');
		// you land INSIDE the token, at the end of its text: ← is ordinary editing until the text runs
		// out, and only the press past its left edge steps to the token before it
		await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');
		expect(diceTray.draft).toBe('d20');
		expect(diceTray.lines[0]?.pills.map((p) => p.text)).toEqual(['+7']);
		// what is typed now lands where the caret STANDS, not at the end of the line
		await userEvent.keyboard(' 2d4 ');
		expect(diceTray.lines[0]?.pills.map((p) => p.text)).toEqual(['d20', '2d4', '+7']);
	});

	it('a focused pill is the selected pill — Delete removes it', async () => {
		const { diceTray, caret } = await mount();
		await typeInto(caret(), '2d6 1d4 ');
		await userEvent.click(document.querySelectorAll('.roller-pill')[0]!);
		await userEvent.keyboard('{Delete}');
		expect(diceTray.lines[0]?.pills.map((p) => p.text)).toEqual(['1d4']);
	});

	it('a header die lands in the line the caret is in, not always the first', async () => {
		const { diceTray, screen, caret } = await mount();
		await userEvent.click(screen.getByRole('button', { name: '+ damage line' }).element());
		await userEvent.click(caret(1) as Element);
		await userEvent.click(screen.getByRole('button', { name: 'd8' }).element());
		expect(diceTray.lines[0]?.pills).toHaveLength(0);
		expect(diceTray.lines[1]?.role).toBe(ROLLER_ROLE.damage);
		expect(diceTray.lines[1]?.pills[0]).toMatchObject({ sides: 8 });
	});
});
