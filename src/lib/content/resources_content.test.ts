import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { loadContent } from './loader';
import { parseToken } from '../effects/token-parser';
import { readPackFile, loadPacks } from '../../test-support/real-content';
import { resourceNames } from '../character/resource-names';

/*
 * Guards the SHIPPED resource names (RES-NAME): every pool a class feature grants must be NAMED by a
 * `resource` row, in both editions. The fallback for an unnamed pool is a title-cased id, which is
 * silently plausible for most of them and wrong for exactly the ones that matter — `focus` is called
 * "Focus Points" and `ki` "Ki Points" in the SRD's own text, and neither is derivable.
 *
 * Names are asserted literally because they were read off each edition's shipped text: a converter
 * re-run that drops the file, or a rename, fails here rather than quietly reverting to `titleCase`.
 */
const EDITIONS = [
	['5.5e', 'srd-2024', { focus: 'Focus Points', rage: 'Rage' }],
	['5e', 'srd-2014', { ki: 'Ki Points', rage: 'Rage' }],
] as const;

/** Every pool id the edition's class features actually grant. */
function grantedPoolIds(pack: string): Set<string> {
	const out = new Set<string>();
	for (const line of readPackFile(pack, 'class_features_srd.csv').split('\n'))
		for (const m of line.matchAll(/grant_resource:([a-z_0-9]+)/g)) out.add(m[1] as string);
	return out;
}

describe('shipped resource names · every granted pool has one', () => {
	for (const [system, pack, expected] of EDITIONS) {
		describe(system, () => {
			it('names every pool the class features grant, and names them as the SRD does', async () => {
				const s = new MemoryStorage();
				await s.write('c/resources_srd.csv', readPackFile(pack, 'resources_srd.csv'));
				const graph = await loadContent(s, ['c']);
				expect(graph.issues.filter((i) => i.level === 'error')).toEqual([]);

				const names = resourceNames(graph, system, () => true);
				for (const id of grantedPoolIds(pack))
					expect(names.get(id), `pool "${id}" has no resource row`).toBeTruthy();
				for (const [id, name] of Object.entries(expected)) expect(names.get(id)).toBe(name);
			});
		});
	}

	it('the whole shipped graph resolves the names the class features grant', async () => {
		const graph = await loadPacks('srd-2024', 'srd-2014');
		const names = resourceNames(graph, '5.5e', () => true);
		// the case the id could never have produced: the feature is "Monk's Focus", the id is `focus`,
		// and the pool is "Focus Points"
		expect(names.get('focus')).toBe('Focus Points');
		// and the token that grants it is still a valid one — the row names a pool that exists
		const monk = graph
			.list('class_feature', { system: '5.5e' })
			.find((r) => r.id === 'monk_monks_focus');
		const granted = (monk?.data.effects ?? [])
			.map((t) => parseToken(t))
			.find((p) => p.resource !== undefined);
		expect(granted?.resource?.id).toBe('focus');
	});
});
