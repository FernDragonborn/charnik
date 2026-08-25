import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import Roller from './Roller.svelte';
import { RollerOrgan } from '$lib/dice/roller.svelte';
import { rollerCandidates, type NamedRollSource } from '$lib/dice/roller-vocabulary';
import { PILL_KIND, ROLLER_ROLE } from '$lib/dice/roller';

/*
 * The organ's KEYBOARD, in a real browser — the half of the design that unit tests can't reach,
 * because it is about what a keypress does to a caret, a menu and a pill. The model beneath is
 * covered in `dice/roller*.test.ts`; these assert that the wiring above it actually fires.
 */
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
	const organ = new RollerOrgan();
	organ.candidates = rollerCandidates(SOURCES, 'en');
	const onroll = vi.fn();
	const screen = await render(Roller, { organ, onroll });
	const caret = (line = 0) => document.querySelectorAll<HTMLInputElement>('.roller-input')[line];
	return { organ, onroll, screen, caret };
}

/** Type into a line, starting from its caret. */
async function typeInto(input: Element | undefined, text: string) {
	await userEvent.click(input as Element);
	await userEvent.keyboard(text);
}

describe('the roller organ (browser)', () => {
	it('parses a token on the space after it, and the pill carries the number', async () => {
		const { organ, caret } = await mount();
		await typeInto(caret(), '2d6 +3 ');
		expect(organ.lines[0]?.pills.map((p) => p.kind)).toEqual([PILL_KIND.dice, PILL_KIND.flat]);
		expect(document.querySelectorAll('.roller-pill')).toHaveLength(2);
	});

	it('opens the menu on a letter and Tab takes the highlighted row', async () => {
		const { organ, caret } = await mount();
		await typeInto(caret(), 'bl');
		expect(document.querySelector('.roller-menu')).not.toBeNull();
		await userEvent.keyboard('{Tab}');
		// the die arrives WITH its provenance — the whole point of picking a name over typing 1d4
		expect(organ.lines[0]?.pills[0]).toMatchObject({ sides: 4, source: 'Bless' });
		expect(document.querySelector('.roller-menu')).toBeNull();
	});

	it('moves the caret into the menu and back out of its top row', async () => {
		const { organ, caret } = await mount();
		// ONE match, so the row ↓ enters on is the top row: with several, ↓ steps past the top one
		// (which already reads as selected — it is what the ghost previews) and ↑ walks back through it
		await typeInto(caret(), 'bles');
		expect(organ.inMenu).toBe(false);
		await userEvent.keyboard('{ArrowDown}');
		expect(organ.inMenu).toBe(true);
		await userEvent.keyboard('{ArrowUp}');
		expect(organ.inMenu).toBe(false);
	});

	it('Escape closes the menu and leaves the text where it was', async () => {
		const { organ, caret } = await mount();
		await typeInto(caret(), 'bl{Escape}');
		expect(document.querySelector('.roller-menu')).toBeNull();
		expect(organ.draft).toBe('bl');
	});

	it('Backspace at the left edge unfolds the last pill back into text', async () => {
		const { organ, caret } = await mount();
		await typeInto(caret(), '2d6 {Backspace}');
		expect(organ.lines[0]?.pills).toHaveLength(0);
		expect(organ.draft).toBe('2d6');
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
		await expect.element(screen.getByRole('button', { name: 'Roll' })).toBeDisabled();
		expect(document.querySelector('.roller-blocked')).not.toBeNull();
		expect(onroll).not.toHaveBeenCalled();
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
		const { organ, screen, caret } = await mount();
		await userEvent.click(screen.getByRole('button', { name: '+ damage line' }).element());
		await typeInto(caret(), '2d6 +3');
		await userEvent.click(caret(1) as Element);
		expect(organ.lines[0]?.pills.map((p) => p.kind)).toEqual([PILL_KIND.dice, PILL_KIND.flat]);
		expect(organ.drafts[0]).toBe('');
	});

	it('← at the left edge steps into the token before the caret', async () => {
		const { organ, caret } = await mount();
		await typeInto(caret(), 'd20 +7 ');
		await userEvent.keyboard('{ArrowLeft}');
		expect(organ.draft).toBe('+7');
		// you land INSIDE the token, at the end of its text: ← is ordinary editing until the text runs
		// out, and only the press past its left edge steps to the token before it
		await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');
		expect(organ.draft).toBe('d20');
		expect(organ.lines[0]?.pills.map((p) => p.text)).toEqual(['+7']);
		// what is typed now lands where the caret STANDS, not at the end of the line
		await userEvent.keyboard(' 2d4 ');
		expect(organ.lines[0]?.pills.map((p) => p.text)).toEqual(['d20', '2d4', '+7']);
	});

	it('a focused pill is the selected pill — Delete removes it', async () => {
		const { organ, caret } = await mount();
		await typeInto(caret(), '2d6 1d4 ');
		await userEvent.click(document.querySelectorAll('.roller-pill')[0]!);
		await userEvent.keyboard('{Delete}');
		expect(organ.lines[0]?.pills.map((p) => p.text)).toEqual(['1d4']);
	});

	it('a header die lands in the line the caret is in, not always the first', async () => {
		const { organ, screen, caret } = await mount();
		await userEvent.click(screen.getByRole('button', { name: '+ damage line' }).element());
		await userEvent.click(caret(1) as Element);
		await userEvent.click(screen.getByRole('button', { name: 'd8' }).element());
		expect(organ.lines[0]?.pills).toHaveLength(0);
		expect(organ.lines[1]?.role).toBe(ROLLER_ROLE.damage);
		expect(organ.lines[1]?.pills[0]).toMatchObject({ sides: 8 });
	});
});
