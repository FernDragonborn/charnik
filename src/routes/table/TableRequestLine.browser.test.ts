import { describe, it, expect, beforeAll } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import TableRequestLine from './TableRequestLine.svelte';
import { startI18n, locale, waitLocale } from '$lib/i18n';
import { TABLE_REQUEST } from '$lib/table-link/types';

beforeAll(async () => {
	await startI18n('en');
	void locale.set('en');
	await waitLocale();
});

/* audit-nov-17 T10: the prompt named a state by the first row of its id in the graph, while
 * Accept puts on the row of the character's own edition and sources. */
describe('TableRequestLine (browser)', () => {
	it('names a requested state as the open sheet would put it on', async () => {
		await render(TableRequestLine, {
			request: { kind: TABLE_REQUEST.effect, id: 'blessed' },
			sheetState: (id: string) => (id === 'blessed' ? 'Blessed (2024)' : undefined),
		});
		await expect.element(page.getByText(/Blessed \(2024\)/)).toBeInTheDocument();
	});
});
