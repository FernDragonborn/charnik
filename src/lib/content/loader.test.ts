import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { loadContent } from './loader';
import { hasContentRepo, loadPacks } from '../../test-support/real-content';

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
				spell('shield', '5.5e', 'SRD 5.2.1'),
			].join('\n'),
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
				spell('fireball', '5.5e', 'SRD 5.2.1'),
			].join('\n'),
		);
		const g = await loadContent(s, ['a']);
		// the message is prose for the user; the identifier that clashed is the durable part (UX-1)
		expect(
			g.issues.some((i) => i.level === 'error' && !!i.detail?.includes('spell:SRD 5.2.1:fireball')),
		).toBe(true);
		// B22: the dup is dropped from every scanned collection so its tokens can't apply twice
		expect(g.list('spell').filter((r) => r.id === 'fireball')).toHaveLength(1);
		expect(g.rows.filter((r) => r.effectiveId === 'spell:SRD 5.2.1:fireball')).toHaveLength(1);
	});

	it('flags a malformed locale column but still loads the row', async () => {
		const s = new MemoryStorage();
		await s.write(
			'a/spells_srd.csv',
			[SPELL_HEAD + ',name_spanish', spell('fireball', '5.5e', 'SRD 5.2.1') + ',Bola'].join('\n'),
		);
		const g = await loadContent(s, ['a']);
		expect(g.issues.some((i) => i.level === 'warn' && !!i.detail?.includes('name_spanish'))).toBe(
			true,
		);
		expect(g.locales).not.toContain('spanish');
		expect(g.list('spell').length).toBe(1);
	});

	it('B11: skips a CSV over the 20 MB byte cap with a visible error (not silent truncate)', async () => {
		const s = new MemoryStorage();
		// cap check runs before parse, so the body needn't be valid CSV — just over 20 MB
		await s.write('a/spells_srd.csv', 'x'.repeat(20 * 1024 * 1024 + 1));
		const g = await loadContent(s, ['a']);
		expect(g.list('spell').length).toBe(0); // skipped whole file, no partial load
		expect(
			g.issues.some((i) => i.level === 'error' && i.file === 'spells_srd.csv' && !!i.detail),
		).toBe(true);
	});

	it('flags an invalid row without crashing the rest', async () => {
		const s = new MemoryStorage();
		await s.write(
			'a/spells_srd.csv',
			[SPELL_HEAD, spell('ok', '5.5e', 'SRD 5.2.1'), spell('bad', '3.5e', 'SRD 5.2.1')].join('\n'),
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
			['#content-type: spell', SPELL_HEAD, spell('zap', '5.5e', 'Homebrew')].join('\n'),
		);
		const g = await loadContent(s, ['a']);
		expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
		expect(g.get('spell:Homebrew:zap')).toBeTruthy();
		// no "can't tell what this file holds" warning, because the directive resolved it
		expect(g.issues.some((i) => i.file === 'my_cool_spells.csv')).toBe(false);
	});

	it('errors on a #content-type directive naming an unknown type', async () => {
		const s = new MemoryStorage();
		await s.write(
			'a/stuff.csv',
			['#content-type: gizmo', SPELL_HEAD, spell('zap', '5.5e', 'SRD 5.2.1')].join('\n'),
		);
		const g = await loadContent(s, ['a']);
		expect(g.issues.some((i) => i.level === 'error' && i.detail === '#content-type: gizmo')).toBe(
			true,
		);
		expect(g.list('spell').length).toBe(0);
	});

	it('still warns on a freely-named file with no directive and no filename match', async () => {
		const s = new MemoryStorage();
		await s.write('a/whatever.csv', [SPELL_HEAD, spell('zap', '5.5e', 'SRD 5.2.1')].join('\n'));
		const g = await loadContent(s, ['a']);
		expect(g.issues.some((i) => i.level === 'warn' && i.file === 'whatever.csv')).toBe(true);
		expect(g.list('spell').length).toBe(0); // and nothing was guessed into the graph
	});

	it('flags a file missing a REQUIRED metadata key (source/license) as a metaIssue', async () => {
		const s = new MemoryStorage();
		// header declares source but NOT license → the ContentMetaModal should be offered
		await s.write(
			'a/spells_srd.csv',
			['#content-source: Homebrew', SPELL_HEAD, spell('zap', '5.5e', 'Homebrew')].join('\n'),
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
				spell('zap', '5.5e', 'Homebrew'),
			].join('\n'),
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
		const { stampWithHash } = await import('./hash');
		const body = [SPELL_HEAD, spell('zap', '5.5e', 'Homebrew')].join('\n') + '\n';
		await s.write(
			'a/spells_srd.csv',
			await stampWithHash(
				new Map([
					['source', 'Homebrew'],
					['license', 'CC-BY-4.0'],
				]),
				body,
			),
		);
		const g = await loadContent(s, ['a']);
		expect(g.driftItems).toEqual([]);
	});

	it('resolveRefs reports missing referenced content (render-what-you-can)', async () => {
		const g = await loadContent(await seed(), ['a', 'b']);
		const { found, missing } = g.resolveRefs([
			'spell:SRD 5.2.1:fireball',
			'spell:SRD 5.2.1:does-not-exist',
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
				'untouched,5.5e,SRD 5.2.1,Deafened,,Cannot hear,', // no uk at all → silent (EN fallback)
			].join('\n'),
		);
		const g = await loadContent(s, ['a']);
		const warns = g.issues.filter((i) => i.level === 'warn' && !!i.detail?.startsWith('empty '));
		expect(warns.map((w) => w.id)).toEqual(['partial']);
		expect(warns[0]?.detail).toMatch(/text_uk/); // which column to fill is the actionable half
	});
});

// Integration: load the real shipped content and assert it indexes cleanly.
describe('loader — real content', () => {
	it.runIf(hasContentRepo)(
		'loads both edition roots with zero errors and wires cross-edition articles',
		async () => {
			const g = await loadPacks('srd-2024', 'srd-2014');
			expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
			expect(g.list('spell').length).toBe(339 + 319);
			expect(g.list('monster').length).toBe(330 + 317); // 5.1 = 201 chapter + 116 appendix
			// E1: 5.5e languages exist now (SRD 5.2.1: 10 Standard + 9 Rare) alongside 2014's 16
			expect(g.list('language').length).toBe(19 + 16);
			expect(g.list('language', { system: '5.5e' }).length).toBe(19);

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
		},
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

describe('localization status columns + source language', () => {
	const HEAD =
		'id,systems,source,name_en,name_uk,loc_status_uk,level,school,casting_time,range,components,duration,concentration,ritual';
	const line = (id: string, name_uk: string, status: string) =>
		`${id},5.5e,SRD 5.2.1,${id},${name_uk},${status},3,evocation,Action,150 feet,V,Instantaneous,false,false`;

	it('re-attaches loc_status_<loc> to row.data without inventing a locale', async () => {
		const s = new MemoryStorage();
		await s.write('a/spells_srd.csv', [HEAD, line('fireball', 'Вогняна', 'reviewed')].join('\n'));
		const g = await loadContent(s, ['a']);
		const d = g.get('spell:SRD 5.2.1:fireball')!.data;
		expect(d.loc_status_uk).toBe('reviewed');
		// a status column carries no prose, so it must NOT register a phantom locale (only name_/text_ do)
		expect(g.locales).not.toContain('status');
	});

	it('reads #content-source-lang, defaulting to en', async () => {
		const s = new MemoryStorage();
		await s.write('a/spells_srd.csv', [HEAD, line('fireball', '', '')].join('\n'));
		await s.write(
			'b/spells_uk.csv',
			['#content-source-lang: uk', HEAD, line('lightning', 'Блискавка', '')].join('\n'),
		);
		const g = await loadContent(s, ['a', 'b']);
		expect(g.get('spell:SRD 5.2.1:fireball')!.sourceLang).toBe('en');
		expect(g.get('spell:SRD 5.2.1:lightning')!.sourceLang).toBe('uk');
	});
});
