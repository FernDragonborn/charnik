import { describe, it, expect, beforeEach } from 'vitest';
import { userEvent } from 'vitest/browser';
import { submitOnEnter } from './submitOnEnter';

/** A panel holding `fields`, with the action on it; returns how many times it submitted. */
function panel(fields: string, submit: boolean = true) {
	const node = document.createElement('div');
	node.innerHTML = fields;
	document.body.append(node);
	const count = { n: 0 };
	submitOnEnter(node, submit ? () => count.n++ : undefined);
	return { node, count };
}

describe('submitOnEnter', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
	});

	it('Enter in a one-line field does the panel’s main act', async () => {
		const { node, count } = panel('<input type="number" /><input />');
		for (const field of node.querySelectorAll('input')) {
			field.focus();
			await userEvent.keyboard('{Enter}');
		}
		expect(count.n).toBe(2);
	});

	it('a textarea keeps Enter for its newline, and a checkbox for itself', async () => {
		const { node, count } = panel('<textarea></textarea><input type="checkbox" />');
		const area = node.querySelector('textarea');
		area?.focus();
		await userEvent.keyboard('{Enter}');
		node.querySelector<HTMLInputElement>('input')?.focus();
		await userEvent.keyboard('{Enter}');
		expect(count.n).toBe(0);
		expect(area?.value).toBe('\n');
	});

	it('a field that answered Enter itself is left alone', async () => {
		const { node, count } = panel('<input />');
		const field = node.querySelector('input');
		field?.addEventListener('keydown', (e) => e.key === 'Enter' && e.preventDefault());
		field?.focus();
		await userEvent.keyboard('{Enter}');
		expect(count.n).toBe(0);
	});

	it('with no main act available, Enter does nothing', async () => {
		const { node, count } = panel('<input />', false);
		node.querySelector('input')?.focus();
		await userEvent.keyboard('{Enter}');
		expect(count.n).toBe(0);
	});
});
