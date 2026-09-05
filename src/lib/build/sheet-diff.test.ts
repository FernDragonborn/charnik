import { describe, it, expect } from 'vitest';
import { makeTempContentRoot } from '../../test-support/fixtures';
import { type ContentGraph } from '../content/loader';
import { newCharacter, type Character } from '../character/schema';
import { deriveSheet } from '../character/derive';
import { diffSheets } from './sheet-diff';
import { socialBars } from './social';
import { ABILITY_IDS } from '../rules/core';
import { SKILL_ABILITY } from '../character/skills';
import { DAMAGE_TYPES } from '../components/damage-glyphs';
import en from '../i18n/locales/en.json';

const S = 'SRD 5.2.1';

/** The smallest graph a sheet can derive from: one class, one background that boosts + trains. */
async function graphOf(): Promise<ContentGraph> {
	return makeTempContentRoot({
		'classes_srd.csv': [
			'id,systems,source,name_en,hit_die,saves,caster,spell_ability,slot_table,weapon_profs,armor_profs',
			`fighter,5.5e,${S},Fighter,d10,"str,con",none,,,"simple,martial","light,medium,heavy,shield"`,
			`cleric,5.5e,${S},Cleric,d8,"wis,cha",full,wis,full,simple,"light,medium,shield"`,
			`wizard,5.5e,${S},Wizard,d6,"int,wis",full,int,full,simple,`,
		].join('\n'),
		'backgrounds_srd.csv': ['id,systems,source,name_en,skills', `soldier,5.5e,${S},Soldier,"athletics,intimidation"`].join(
			'\n',
		),
	});
}

function fighter(): Character {
	const c = newCharacter('ilmar', 'Ilmar', '5.5e');
	c.build.classes = [{ class: `class:${S}:fighter`, level: 5 }];
	c.build.abilities = { str: 15, dex: 10, con: 14, int: 8, wis: 12, cha: 14 };
	return c;
}

describe('diffSheets', () => {
	it('an identical sheet produces no rows — an unchanged number is not information', async () => {
		const g = await graphOf();
		const sheet = deriveSheet(fighter(), g);
		expect(diffSheets(sheet, sheet)).toEqual([]);
	});

	it('reports spellcasting by class, not by row position (B10)', async () => {
		const g = await graphOf();
		const duo = fighter();
		duo.build.classes = [
			{ class: `class:${S}:cleric`, level: 5 },
			{ class: `class:${S}:wizard`, level: 3 },
		];
		const before = deriveSheet(duo, g);

		// row 0 becomes a Fighter: the CLERIC loses spellcasting, the wizard is untouched — read
		// positionally this said the wizard's DC got worse and never mentioned the cleric at all
		const swapped = fighter();
		swapped.build.classes = [
			{ class: `class:${S}:fighter`, level: 5 },
			{ class: `class:${S}:wizard`, level: 3 },
		];
		const rows = diffSheets(before, deriveSheet(swapped, g));

		expect(rows.find((r) => r.id.includes('wizard'))).toBeUndefined();
		const lostDc = rows.find((r) => r.id === `spellDc-class:${S}:cleric`);
		expect(lostDc?.to).toEqual({ text: '—' }); // not "0", which is a number nobody had
		expect(lostDc?.better).toBe(false);
	});

	it('a raised ability reports the score and everything downstream of it', async () => {
		const g = await graphOf();
		const before = deriveSheet(fighter(), g);
		const stronger = fighter();
		stronger.build.abilityBoosts = { con: 2 };
		const rows = diffSheets(before, deriveSheet(stronger, g));

		expect(rows.find((r) => r.id === 'con')).toMatchObject({
			label: { key: 'abilityShort.con' },
			from: { text: '14' },
			to: { text: '16' },
			better: true,
		});
		// +1 CON mod × 5 levels
		expect(rows.find((r) => r.id === 'maxHp')?.better).toBe(true);
	});

	it('training a skill reports the proficiency tier moving', async () => {
		const g = await graphOf();
		const before = deriveSheet(fighter(), g);
		// the builder folds a background's granted skills into build.skills before deriving
		const trained = fighter();
		trained.build.background = `background:${S}:soldier`;
		trained.build.skills = ['athletics', 'intimidation'];
		const rows = diffSheets(before, deriveSheet(trained, g));

		// keys, not words: this module has no locale, and the pane that renders it does
		expect(rows.find((r) => r.id === 'skill-athletics')).toMatchObject({
			label: { key: 'skillName.athletics' },
			from: { key: 'build.diff.rank.none' },
			to: { key: 'build.diff.rank.proficient' },
			better: true,
		});
	});

	it('an undreived side yields nothing — "we do not know" must not read as "nothing changes"', () => {
		expect(diffSheets(null, null)).toEqual([]);
	});

	/**
	 * Every word this module can produce is a catalog key, and a key with no entry renders as itself.
	 * That failure is silent in the UI — "skillName.arcana" looks like a name until you read it — so
	 * the keys are enumerated here against English rather than trusted.
	 */
	it('every key it can emit exists in the catalog', () => {
		const at = (key: string): unknown =>
			key.split('.').reduce<unknown>((node, part) => {
				if (typeof node !== 'object' || node === null) return undefined;
				return (node as Record<string, unknown>)[part];
			}, en);

		const keys = [
			...Object.keys(SKILL_ABILITY).map((id) => `skillName.${id}`),
			...['none', 'half', 'proficient', 'expertise'].map((r) => `build.diff.rank.${r}`),
			...ABILITY_IDS.map((ab) => `abilityShort.${ab}`),
			...ABILITY_IDS.map((ab) => `combat.roll.save.${ab}`),
			'build.diff.speed',
			'build.diff.proficiency',
			'build.diff.carryCapacity',
			'build.diff.resistant',
			'build.diff.immune',
			'build.diff.vulnerable',
			'build.vitals.ac',
			'build.vitals.maxHp',
			'build.vitals.initiative',
			'build.vitals.spellDc',
			'build.vitals.spellAttack',
			'build.diff.spellDcFor',
			'build.diff.spellAttackFor',
			// the `{ keys: [...] }` form, which the enumeration used to skip entirely — a resistance row
			// names its damage types, and every SHIPPED type has to have a word
			...DAMAGE_TYPES.map((d) => `damageType.${d}`),
		];
		expect(keys.filter((k) => typeof at(k) !== 'string')).toEqual([]);
	});
});

describe('socialBars', () => {
	it('names the best skill behind each bar and scales it into 0…1', async () => {
		const g = await graphOf();
		const sheet = deriveSheet(fighter(), g);
		const bars = socialBars(sheet.passives);

		expect(bars.map((b) => b.id)).toEqual(['sway', 'read', 'lore']);
		// CHA 14 (+2) beats the WIS/DEX-based social skills → passive 12
		const sway = bars.find((b) => b.id === 'sway');
		expect(sway).toMatchObject({ passive: 12 });
		// a skill ID, not a word: this module has no locale, and the component says the name
		expect(['persuasion', 'intimidation', 'deception', 'performance']).toContain(sway?.via);
		expect(sway?.fill).toBeCloseTo((12 - 5) / 25);
	});

	it('no passives → no bars (a sheet that has not derived shows nothing)', () => {
		expect(socialBars(undefined)).toEqual([]);
	});
});
