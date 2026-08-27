import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { loadContent, type ContentGraph } from '../content/loader';
import { newCharacter, type Character } from '../character/schema';
import { deriveSheet } from '../character/derive';
import { diffSheets } from './sheet-diff';
import { socialBars } from './social';

const S = 'SRD 5.2.1';

/** The smallest graph a sheet can derive from: one class, one background that boosts + trains. */
async function graphOf(): Promise<ContentGraph> {
	const st = new MemoryStorage();
	await st.write(
		'c/classes_srd.csv',
		[
			'id,systems,source,name_en,hit_die,saves,caster,weapon_profs,armor_profs',
			`fighter,5.5e,${S},Fighter,d10,"str,con",none,"simple,martial","light,medium,heavy,shield"`,
		].join('\n'),
	);
	await st.write(
		'c/backgrounds_srd.csv',
		['id,systems,source,name_en,skills', `soldier,5.5e,${S},Soldier,"athletics,intimidation"`].join(
			'\n',
		),
	);
	const g = await loadContent(st, ['c']);
	expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
	return g;
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

	it('a raised ability reports the score and everything downstream of it', async () => {
		const g = await graphOf();
		const before = deriveSheet(fighter(), g);
		const stronger = fighter();
		stronger.build.abilityBoosts = { con: 2 };
		const rows = diffSheets(before, deriveSheet(stronger, g));

		expect(rows.find((r) => r.label === 'CON')).toMatchObject({
			from: '14',
			to: '16',
			better: true,
		});
		// +1 CON mod × 5 levels
		expect(rows.find((r) => r.label === 'Max HP')?.better).toBe(true);
	});

	it('training a skill reports the proficiency tier moving', async () => {
		const g = await graphOf();
		const before = deriveSheet(fighter(), g);
		// the builder folds a background's granted skills into build.skills before deriving
		const trained = fighter();
		trained.build.background = `background:${S}:soldier`;
		trained.build.skills = ['athletics', 'intimidation'];
		const rows = diffSheets(before, deriveSheet(trained, g));

		expect(rows.find((r) => r.label === 'Athletics')).toMatchObject({
			from: 'none',
			to: 'proficient',
			better: true,
		});
	});

	it('an undreived side yields nothing — "we do not know" must not read as "nothing changes"', () => {
		expect(diffSheets(null, null)).toEqual([]);
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
		expect(['Persuasion', 'Intimidation', 'Deception', 'Performance']).toContain(sway?.via);
		expect(sway?.fill).toBeCloseTo((12 - 5) / 25);
	});

	it('no passives → no bars (a sheet that has not derived shows nothing)', () => {
		expect(socialBars(undefined)).toEqual([]);
	});
});
