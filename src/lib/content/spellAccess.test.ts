import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { loadContent } from './loader';
import { buildSpellAccess } from './spellAccess';

const SPELL_HEAD =
	'id,systems,source,name_en,level,school,casting_time,range,components,duration,concentration,ritual,classes';
const spell = (id: string, systems: string, source: string, classes: string) =>
	`${id},${systems},${source},${id},3,evocation,1 action,150 feet,V,Instantaneous,false,false,"${classes}"`;

const CLASS_HEAD = 'id,systems,source,name_en,hit_die,saves,caster';
const cls = (id: string, systems: string, source: string, caster = 'full') =>
	`${id},${systems},${source},${id},d6,"int,wis",${caster}`;

const LIST_HEAD = 'id,systems,source,class_id,spell_id';

async function seed() {
	const s = new MemoryStorage();
	// 2024 root
	await s.write(
		'a/spells_srd.csv',
		[
			SPELL_HEAD,
			spell('fireball', '5.5e', 'SRD 5.2.1', 'wizard,sorcerer'),
			spell('cure-wounds', '5.5e', 'SRD 5.2.1', 'cleric')
		].join('\n')
	);
	await s.write('a/classes_srd.csv', [CLASS_HEAD, cls('wizard', '5.5e', 'SRD 5.2.1')].join('\n'));
	// homebrew pack: an Artificer that grants access to fireball via a class-side join (no edit
	// to the shipped fireball row)
	await s.write(
		'hb/classes_srd.csv',
		[CLASS_HEAD, cls('artificer', '5.5e', 'Homebrew', 'half')].join('\n')
	);
	await s.write(
		'hb/spell_lists_hb.csv',
		[LIST_HEAD, 'artificer-fireball,5.5e,Homebrew,artificer,fireball'].join('\n')
	);
	// 2014 root — a wizard + a 5e-only spell, to prove edition scoping
	await s.write(
		'b/spells_srd.csv',
		[SPELL_HEAD, spell('magic-missile', '5e', 'SRD 5.1', 'wizard')].join('\n')
	);
	await s.write('b/classes_srd.csv', [CLASS_HEAD, cls('wizard', '5e', 'SRD 5.1')].join('\n'));
	return s;
}

describe('spell↔class access (union index)', () => {
	it('unions inline classes + class-side spell_lists, edition-scoped', async () => {
		const g = await loadContent(await seed(), ['a', 'hb', 'b']);
		expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
		const access = buildSpellAccess(g);

		// 2024 wizard reaches fireball (inline) but NOT the 2014-only magic-missile
		const wiz24 = access.spellIdsForClass('class:SRD 5.2.1:wizard');
		expect(wiz24).toContain('spell:SRD 5.2.1:fireball');
		expect(wiz24).not.toContain('spell:SRD 5.1:magic-missile');

		// 2014 wizard reaches the 5e spell, not the 2024 fireball
		const wiz14 = access.spellIdsForClass('class:SRD 5.1:wizard');
		expect(wiz14).toContain('spell:SRD 5.1:magic-missile');
		expect(wiz14).not.toContain('spell:SRD 5.2.1:fireball');

		// the homebrew Artificer reaches fireball WITHOUT the fireball row being edited
		expect(access.spellIdsForClass('class:Homebrew:artificer')).toContain(
			'spell:SRD 5.2.1:fireball'
		);
	});

	it('reverse index carries provenance (class-list vs spell-list)', async () => {
		const g = await loadContent(await seed(), ['a', 'hb', 'b']);
		const access = buildSpellAccess(g);
		const entries = access.classesForSpell('spell:SRD 5.2.1:fireball');
		const byClass = Object.fromEntries(entries.map((e) => [e.classId, e.via]));
		expect(byClass.wizard).toBe('class-list'); // from spells.classes
		expect(byClass.artificer).toBe('spell-list'); // from the additive join
		// sorcerer is on fireball's list but has no class row → not linked
		expect(byClass.sorcerer).toBeUndefined();
	});

	it('warns on an orphan spell_lists join (likely a typo)', async () => {
		const s = await seed();
		await s.write(
			'hb/spell_lists_bad.csv',
			[
				'id,systems,source,class_id,spell_id',
				'x,5.5e,Homebrew,warlock-typo,fireball', // unknown class
				'y,5.5e,Homebrew,artificer,spell-typo' // unknown spell
			].join('\n')
		);
		const g = await loadContent(s, ['a', 'hb', 'b']);
		const warns = g.issues.filter((i) => i.level === 'warn').map((i) => i.message);
		expect(warns.some((m) => /unknown class "warlock-typo"/.test(m))).toBe(true);
		expect(warns.some((m) => /unknown spell "spell-typo"/.test(m))).toBe(true);
	});
});
