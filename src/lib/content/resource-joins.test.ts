import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { loadContent } from './loader';
import { loadPacks } from '../../test-support/real-content';
import { resourceJoinIssues, grantedPoolIds } from './resource-joins';

const S = 'SRD 5.2.1';

/** A graph with ONE granted pool (`focus`), plus whatever rows a case needs. */
async function graphOf(extra: Record<string, string>) {
	const s = new MemoryStorage();
	await s.write(
		'c/class_features_srd.csv',
		[
			'id,systems,source,name_en,effects,class_id,level',
			`monk_monks_focus,5.5e,${S},Monk's Focus,grant_resource:focus:2:short,monk,2`,
		].join('\n'),
	);
	for (const [path, body] of Object.entries(extra)) await s.write(path, body);
	return loadContent(s, ['c']);
}

const OPTION_HEAD = 'id,systems,source,name_en,resource_id,cost,action,action_type';

describe('resource joins', () => {
	it('finds the pools that are actually granted, from the token itself', async () => {
		const g = await graphOf({});
		expect([...grantedPoolIds(g, '5.5e')]).toEqual(['focus']);
		expect([...grantedPoolIds(g, '5e')]).toEqual([]); // edition-scoped
	});

	it('sees a GUARDED grant — a working option must never be reported as broken', async () => {
		const s = new MemoryStorage();
		await s.write(
			'c/class_features_srd.csv',
			[
				'id,systems,source,name_en,effects,class_id,level',
				`frenzy,5.5e,${S},Frenzy,is_raging ? grant_resource:frenzy:2:long,barbarian,3`,
			].join('\n'),
		);
		await s.write(
			'c/resource_options_srd.csv',
			[OPTION_HEAD, `rampage,5.5e,${S},Rampage,frenzy,1,note:again,bonus_action`].join('\n'),
		);
		const g = await loadContent(s, ['c']);
		expect([...grantedPoolIds(g, '5.5e')]).toEqual(['frenzy']);
		expect(resourceJoinIssues(g, '5.5e')).toEqual([]);
	});

	it('flags an option whose resource_id nothing grants — the silent case', async () => {
		const g = await graphOf({
			'c/resource_options_srd.csv': [
				OPTION_HEAD,
				`flurry,5.5e,${S},Flurry of Blows,focus,1,note:two strikes,bonus_action`,
				`ghost,5.5e,${S},Ghost Option,focuss,1,note:nothing,bonus_action`, // typo'd id
			].join('\n'),
		});
		const issues = resourceJoinIssues(g, '5.5e');
		expect(issues.map((i) => i.id)).toEqual(['ghost']); // the resolving one is not reported
		expect(issues[0]?.detail).toBe('resource_id "focuss"');
		expect(issues[0]?.message).toMatch(/did you mean "focus"\?/); // the vocabulary is closed
	});

	it('flags a NAME for a pool nothing grants, and stays quiet for one that resolves', async () => {
		const g = await graphOf({
			'c/resources_srd.csv': [
				'id,systems,source,name_en',
				`focus,5.5e,${S},Focus Points`,
				`chi,5.5e,${S},Chi`, // named, but nothing grants it
			].join('\n'),
		});
		const issues = resourceJoinIssues(g, '5.5e');
		expect(issues.map((i) => i.id)).toEqual(['chi']);
		expect(issues[0]?.detail).toBe('id "chi"');
	});

	it('says nothing at all about a graph with no pools in it', async () => {
		const s = new MemoryStorage();
		await s.write(
			'c/resource_options_srd.csv',
			[OPTION_HEAD, `x,5.5e,${S},X,anything,1,note:x,action`].join('\n'),
		);
		// no grants anywhere → we cannot tell a typo from content that simply doesn't ship pools
		expect(resourceJoinIssues(await loadContent(s, ['c']), '5.5e')).toEqual([]);
	});

	it('the SHIPPED content resolves every one of its resource references', async () => {
		const g = await loadPacks('srd-2024', 'srd-2014');
		expect(resourceJoinIssues(g, '5.5e')).toEqual([]);
		expect(resourceJoinIssues(g, '5e')).toEqual([]);
	});
});
