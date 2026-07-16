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
		await s.write(
			'a/spells_srd.csv',
			[
				SPELL_HEAD,
				spell('fireball', '5.5e', 'SRD 5.2.1', 'Вогняна куля'),
				spell('shield', '5.5e', 'SRD 5.2.1')
			].join('\n')
		);
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

	it('honors a #content-type directive for a freely-named file (explicit wins over filename)', async () => {
		const s = new MemoryStorage();
		// filename maps to no type, but the directive declares it — and it parses as spells
		await s.write(
			'a/my_cool_spells.csv',
			['#content-type: spell', SPELL_HEAD, spell('zap', '5.5e', 'Homebrew')].join('\n')
		);
		const g = await loadContent(s, ['a']);
		expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
		expect(g.get('spell:Homebrew:zap')).toBeTruthy();
		// no "unknown content type" warning, because the directive resolved it
		expect(g.issues.some((i) => /unknown content type/.test(i.message))).toBe(false);
	});

	it('errors on a #content-type directive naming an unknown type', async () => {
		const s = new MemoryStorage();
		await s.write(
			'a/stuff.csv',
			['#content-type: gizmo', SPELL_HEAD, spell('zap', '5.5e', 'SRD 5.2.1')].join('\n')
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

	it('flags a file missing a REQUIRED metadata key (source/license) as a metaIssue', async () => {
		const s = new MemoryStorage();
		// header declares source but NOT license → the ContentMetaModal should be offered
		await s.write(
			'a/spells_srd.csv',
			['#content-source: Homebrew', SPELL_HEAD, spell('zap', '5.5e', 'Homebrew')].join('\n')
		);
		const g = await loadContent(s, ['a']);
		const issue = g.metaIssues.find((i) => i.file === 'a/spells_srd.csv');
		expect(issue).toBeTruthy();
		expect(issue!.missingHuman).toContain('license');
		expect(g.driftItems).toEqual([]); // no stored hash → no drift
	});

	it('detects a stale #content-hash as a driftItem (with the declared + actual dates)', async () => {
		const s = new MemoryStorage();
		await s.write(
			'a/spells_srd.csv',
			[
				'#content-source: Homebrew',
				'#content-license: CC-BY-4.0',
				'#content-updated-at: 2020-01-01',
				'#content-hash: xxh64:deadbeef', // deliberately wrong
				SPELL_HEAD,
				spell('zap', '5.5e', 'Homebrew')
			].join('\n')
		);
		const g = await loadContent(s, ['a']);
		const drift = g.driftItems.find((d) => d.file === 'a/spells_srd.csv');
		expect(drift).toBeTruthy();
		expect(drift!.declaredDate).toBe('2020-01-01');
		expect(drift!.changedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/); // from the MemoryStorage mtime
		expect(g.metaIssues).toEqual([]); // source+license present → no meta prompt
	});

	it('a correct #content-hash produces no drift', async () => {
		const s = new MemoryStorage();
		const { hashBody } = await import('./hash');
		const body = [SPELL_HEAD, spell('zap', '5.5e', 'Homebrew')].join('\n') + '\n';
		const hash = await hashBody(body);
		await s.write(
			'a/spells_srd.csv',
			[
				`#content-source: Homebrew`,
				`#content-license: CC-BY-4.0`,
				`#content-hash: ${hash}`,
				body
			].join('\n')
		);
		const g = await loadContent(s, ['a']);
		expect(g.driftItems).toEqual([]);
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

	it('warns on a PARTIALLY translated row, but not on complete or fully-untranslated ones', async () => {
		const s = new MemoryStorage();
		// conditions need only id + name_en, so this isolates the translation-gap check
		await s.write(
			'a/conditions_srd.csv',
			[
				'id,systems,source,name_en,name_uk,text_en,text_uk',
				'partial,5.5e,SRD 5.2.1,Blinded,Осліплений,Cannot see,', // name_uk set, text_uk missing → PARTIAL
				'complete,5.5e,SRD 5.2.1,Charmed,Зачарований,Cannot attack,Не може атакувати', // both → OK
				'untouched,5.5e,SRD 5.2.1,Deafened,,Cannot hear,' // no uk at all → silent (EN fallback)
			].join('\n')
		);
		const g = await loadContent(s, ['a']);
		const warns = g.issues.filter(
			(i) => i.level === 'warn' && /partial translation/.test(i.message)
		);
		expect(warns.map((w) => w.id)).toEqual(['partial']);
		expect(warns[0]?.message).toMatch(/text_uk/);
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
			expect(feats.some((f) => f.id === 'barbarian_rage')).toBe(true);

			expect(g.locales).toContain('uk');
		}
	);
});

describe('localized prose columns survive the strict schema', () => {
	// The per-type schema declares only name_/text_ en+uk, so safeParse strips extra locales and
	// extra prose fields; the loader re-attaches them (PROSE_LOCALE_COL) so localized render works.
	it('keeps extra-locale + extra-prose columns (name_de, material_uk, higher_level_uk)', async () => {
		const s = new MemoryStorage();
		const head =
			'id,systems,source,name_en,name_uk,name_de,text_en,material,material_uk,higher_level,higher_level_uk,level,school,casting_time,range,components,duration,concentration,ritual';
		const line =
			'fireball,5.5e,SRD 5.2.1,Fireball,Вогняна,Feuerball,desc,guano,гуано,+1d6,+1к6,3,evocation,Action,150 feet,V,Instantaneous,false,false';
		await s.write('a/spells_srd.csv', [head, line].join('\n'));
		const g = await loadContent(s, ['a']);
		const d = g.get('spell:SRD 5.2.1:fireball')!.data;
		expect(d.name_de).toBe('Feuerball');
		expect(d.material_uk).toBe('гуано');
		expect(d.higher_level_uk).toBe('+1к6');
		expect(g.locales).toEqual(expect.arrayContaining(['de', 'en', 'uk']));
	});
});
