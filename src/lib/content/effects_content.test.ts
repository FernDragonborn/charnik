import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { loadContent } from './loader';
import { parseExpression } from '../effects/expression-parser';
import { readPackFile } from '../../test-support/real-content';

/*
 * Guards the SHIPPED effect rows' `ends_if`: an expression that does not parse ends nothing in play
 * and says nothing there (`play/settle.ts`), so a typo here would keep a Rage running past its RAW end.
 */
const EDITIONS = [
	['5.5e', 'srd-2024'],
	['5e', 'srd-2014'],
] as const;

describe('shipped effects · ends_if is a readable expression', () => {
	for (const [edition, pack] of EDITIONS) {
		it(edition, async () => {
			const storage = new MemoryStorage();
			await storage.write('c/effects_srd.csv', readPackFile(pack, 'effects_srd.csv'));
			const graph = await loadContent(storage, ['c']);
			const rules = graph
				.list('effect')
				.flatMap((row) => (row.data.ends_if ? [[row.id, row.data.ends_if] as const] : []));
			expect(rules.map(([id]) => id)).toContain('rage');
			for (const [id, rule] of rules) expect([id, parseExpression(rule).ok]).toEqual([id, true]);
		});
	}
});
