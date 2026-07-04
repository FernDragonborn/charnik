import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { MemoryStorage } from '../storage/memory';
import { NodeStorage } from '../storage/node';
import { loadContent } from './loader';

const SPELL_HEAD =
	'id,systems,source,name_en,name_uk,level,school,casting_time,range,components,duration,concentration,ritual';
const spell = (id: string, systems: string, source: string, name_uk = '') =>
	`${id},${systems},${source},${id},${name_uk},3,evocation,1 action,150 feet,V,Instantaneous,false,false`;

describe('loader — logic (in-memory)', () => {
	async function seed() {
		const s = new MemoryStorage();
		await s.write('a/_pack.json', JSON.stringify({ source: 'SRD 5.2.1', systems: ['5.5e'] }));
		await s.write(
			'a/spells_srd.csv',
			[
				SPELL_HEAD,
				spell('fireball', '5.5e', 'SRD 5.2.1', 'Вогняна куля'),
				spell('shield', '5.5e', 'SRD 5.2.1')
			].join('\n')
		);
		await s.write('b/_pack.json', JSON.stringify({ source: 'SRD 5.1', systems: ['5e'] }));
		await s.write('b/spells_srd.csv', [SPELL_HEAD, spell('fireball', '5e', 'SRD 5.1')].join('\n'));
		return s;
	}

	it('merges roots, builds source:id identity, groups articles across editions', async () => {
		const g = await loadContent(await seed(), ['a', 'b']);
		expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
		expect(g.list('spell').length).toBe(3);
		expect(g.get('spell:SRD 5.2.1:fireball')).toBeTruthy();
		expect(g.get('spell:SRD 5.1:fireball')).toBeTruthy();
		// the 5e/5.5e toggle source: same article, two editions
		const editions = g.editionsOf('spell', 'fireball');
		expect(editions.length).toBe(2);
		expect(new Set(editions.flatMap((e) => e.systems))).toEqual(new Set(['5e', '5.5e']));
	});

	it('filters by system and discovers locales from columns', async () => {
		const g = await loadContent(await seed(), ['a', 'b']);
		expect(g.list('spell', { system: '5e' }).length).toBe(1);
		expect(g.list('spell', { system: '5.5e' }).length).toBe(2);
		expect(g.locales).toContain('uk');
		expect(g.locales).toContain('en');
	});

	it('flags an exact source:id clash as an error, keeps loading', async () => {
		const s = new MemoryStorage();
		await s.write(
			'a/spells_srd.csv',
			[
				SPELL_HEAD,
				spell('fireball', '5.5e', 'SRD 5.2.1'),
				spell('fireball', '5.5e', 'SRD 5.2.1')
			].join('\n')
		);
		const g = await loadContent(s, ['a']);
		expect(g.issues.some((i) => i.level === 'error' && /duplicate source:id/.test(i.message))).toBe(
			true
		);
	});

	it('flags a malformed locale column but still loads the row', async () => {
		const s = new MemoryStorage();
		await s.write(
			'a/spells_srd.csv',
			[SPELL_HEAD + ',name_spanish', spell('fireball', '5.5e', 'SRD 5.2.1') + ',Bola'].join('\n')
		);
		const g = await loadContent(s, ['a']);
		expect(
			g.issues.some((i) => i.level === 'warn' && /malformed locale column/.test(i.message))
		).toBe(true);
		expect(g.locales).not.toContain('spanish');
		expect(g.list('spell').length).toBe(1);
	});

	it('flags an invalid row without crashing the rest', async () => {
		const s = new MemoryStorage();
		await s.write(
			'a/spells_srd.csv',
			[SPELL_HEAD, spell('ok', '5.5e', 'SRD 5.2.1'), spell('bad', '3.5e', 'SRD 5.2.1')].join('\n')
		);
		const g = await loadContent(s, ['a']);
		expect(g.list('spell').length).toBe(1); // "ok" loaded, "bad" (systems 3.5e) rejected
		expect(g.issues.some((i) => i.level === 'error' && i.id === 'bad')).toBe(true);
	});

	it('honors a #charnik-type directive for a freely-named file (explicit wins over filename)', async () => {
		const s = new MemoryStorage();
		await s.write('a/_pack.json', JSON.stringify({ source: 'Homebrew', systems: ['5.5e'] }));
		// filename maps to no type, but the directive declares it — and it parses as spells
		await s.write(
			'a/my-cool-spells.csv',
			['#charnik-type: spell', SPELL_HEAD, spell('zap', '5.5e', 'Homebrew')].join('\n')
		);
		const g = await loadContent(s, ['a']);
		expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
		expect(g.get('spell:Homebrew:zap')).toBeTruthy();
		// no "unknown content type" warning, because the directive resolved it
		expect(g.issues.some((i) => /unknown content type/.test(i.message))).toBe(false);
	});

	it('errors on a #charnik-type directive naming an unknown type', async () => {
		const s = new MemoryStorage();
		await s.write(
			'a/stuff.csv',
			['#charnik-type: gizmo', SPELL_HEAD, spell('zap', '5.5e', 'SRD 5.2.1')].join('\n')
		);
		const g = await loadContent(s, ['a']);
		expect(
			g.issues.some((i) => i.level === 'error' && /unknown content type "gizmo"/.test(i.message))
		).toBe(true);
		expect(g.list('spell').length).toBe(0);
	});

	it('still warns on a freely-named file with no directive and no filename match', async () => {
		const s = new MemoryStorage();
		await s.write('a/whatever.csv', [SPELL_HEAD, spell('zap', '5.5e', 'SRD 5.2.1')].join('\n'));
		const g = await loadContent(s, ['a']);
		expect(
			g.issues.some((i) => i.level === 'warn' && /unknown content type for file/.test(i.message))
		).toBe(true);
	});

	it('resolveRefs reports missing referenced content (render-what-you-can)', async () => {
		const g = await loadContent(await seed(), ['a', 'b']);
		const { found, missing } = g.resolveRefs([
			'spell:SRD 5.2.1:fireball',
			'spell:SRD 5.2.1:does-not-exist'
		]);
		expect(found.map((r) => r.id)).toEqual(['fireball']);
		expect(missing).toEqual(['spell:SRD 5.2.1:does-not-exist']);
	});
});

// Integration: load the real shipped content and assert it indexes cleanly.
describe('loader — real content', () => {
	const cwd = process.cwd();
	const has =
		existsSync(resolve(cwd, 'content/srd-2024')) && existsSync(resolve(cwd, 'content/srd-2014'));

	it.runIf(has)(
		'loads both edition roots with zero errors and wires cross-edition articles',
		async () => {
			const g = await loadContent(new NodeStorage(cwd), ['content/srd-2024', 'content/srd-2014']);
			expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
			expect(g.list('spell').length).toBe(339 + 319);
			expect(g.list('monster').length).toBe(330 + 201);

			// fireball exists in both editions with the right systems
			const fb = g.editionsOf('spell', 'fireball');
			expect(fb.length).toBe(2);
			expect(new Set(fb.flatMap((e) => e.systems))).toEqual(new Set(['5e', '5.5e']));

			// linked table resolves: the 2024 Barbarian has base features incl. Rage
			const barb = g.get('class:SRD 5.2.1:barbarian');
			expect(barb).toBeTruthy();
			const feats = g.featuresForClass(barb!);
			expect(feats.some((f) => f.id === 'barbarian-rage')).toBe(true);

			expect(g.locales).toContain('uk');
		}
	);
});
