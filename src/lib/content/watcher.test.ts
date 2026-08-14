import { describe, expect, it } from 'vitest';
import { affectsContent } from './watcher';

/* B24. Every `true` here costs a full graph rebuild (~90 ms) plus a full re-render, and editors emit
   several of these per save — which is the whole reason the filter exists. */
describe('affectsContent', () => {
	it('takes the files a pack actually ships', () => {
		expect(affectsContent('content/srd-2024/spells_srd.csv')).toBe(true);
		expect(affectsContent('content/dark-sun/plugins/ns/main.js')).toBe(true);
		expect(affectsContent('content/dark-sun/plugins/ns/plugin.json')).toBe(true);
	});

	it('drops what an editor leaves lying around mid-save', () => {
		expect(affectsContent('content/srd-2024/spells_srd.csv~')).toBe(false);
		expect(affectsContent('content/srd-2024/.goutputstream-A1B2C3')).toBe(false);
		expect(affectsContent('content/srd-2024/~$spells_srd.xlsx')).toBe(false);
		expect(affectsContent('content/srd-2024/spells_srd.csv.tmp')).toBe(false);
	});

	/* On some platforms removing a folder emits only the folder's own path, and a pack deleted by
	   hand must not stay on screen until the next launch. */
	it('lets a folder event through', () => {
		expect(affectsContent('content/dark-sun')).toBe(true);
		expect(affectsContent('content/dark-sun/')).toBe(true);
		expect(affectsContent('content/srd-2024/plugins')).toBe(true);
	});
});
