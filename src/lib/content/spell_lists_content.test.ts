/*
 * The SHIPPED 2014 class spell lists, against the SRD's own counts.
 *
 * The 2014 `classes` column is produced from the official
 * CC-BY SRD 5.1 PDF — not from the Tabyltop conversion the other 2014 converters read, because that
 * one keeps only some of each page's columns and silently drops 227 of the document's 778 list
 * entries. That loss is invisible in the CSV (a short list is still a valid list), and it left a 2014
 * bard with nothing at 1st level and a 2014 wizard 51 spells short. So the counts are pinned here.
 *
 * The numbers below are the SRD 5.1 Spell Lists section's own, counted off it.
 */
import { describe, it, expect } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { characterSchema, newCharacter, classRow } from '../character/schema';
import { deriveSheet } from '../character/derive';
import { buildSpellGroups } from '../combat/spells';
import { RITUAL_SOURCE } from './schemas';

/** class id → how many spells SRD 5.1 lists for it. */
const SRD_5_1_LIST_SIZE: Record<string, number> = {
	bard: 112,
	cleric: 105,
	druid: 105,
	paladin: 31,
	ranger: 37,
	sorcerer: 120,
	warlock: 64,
	wizard: 204,
};

describe('SRD 5.1 class spell lists (shipped)', () => {
	it('every class lists exactly what the SRD lists, and no spell is on no list', async () => {
		const graph = await loadPacks('srd-2014');
		const spells = graph.list('spell', { system: '5e' });
		expect(spells.length).toBe(319);

		const counts: Record<string, number> = {};
		const orphans: string[] = [];
		for (const row of spells) {
			const classes = String(row.data.classes ?? '')
				.split(',')
				.map((c) => c.trim())
				.filter(Boolean);
			if (!classes.length) orphans.push(row.data.id);
			for (const c of classes) counts[c] = (counts[c] ?? 0) + 1;
		}
		// the SRD's lists name every spell the SRD describes, so a spell on no list means the
		// extraction lost a column — the exact failure the PDF rewrite exists to stop
		expect(orphans).toEqual([]);
		expect(counts).toEqual(SRD_5_1_LIST_SIZE);
	});

	it('a 2014 bard has spells at EVERY level it can cast, 1st included', async () => {
		const graph = await loadPacks('srd-2014');
		const byLevel = new Set(
			graph
				.list('spell', { system: '5e' })
				.filter((r) => String(r.data.classes ?? '').includes('bard'))
				.map((r) => Number(r.data.level)),
		);
		expect([...byLevel].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});
});

/*
 * Ritual casting as SHIPPED. Which spells are rituals is each SRD's own tag; who may cast one, and
 * from what, is each SRD's own sentence — so both are asserted literally, per edition.
 *
 * SRD 5.1 says it per class, in that class's Spellcasting feature: a bard "any bard spell you know",
 * a cleric and a druid one they "have … prepared", a wizard one "in your spellbook"; no other class
 * has the feature. SRD 5.2.1 says it once, for everyone (Spells ▸ Casting Time ▸ Rituals: "To cast a
 * spell as a Ritual, a spellcaster must have it prepared"), and Wizard ▸ Ritual Adept lifts the
 * preparation for a spell in the spellbook.
 */
describe.each([
	{
		system: '5e',
		pack: 'srd-2014',
		source: 'SRD 5.1',
		rituals: 29,
		sources: { bard: 'prepared', cleric: 'prepared', druid: 'prepared', wizard: 'spellbook' },
		// a 2014 sorcerer has no ritual casting at all, prepared or not
		without: 'sorcerer',
	},
	{
		system: '5.5e',
		pack: 'srd-2024',
		source: 'SRD 5.2.1',
		rituals: 29,
		sources: {
			bard: 'prepared',
			cleric: 'prepared',
			druid: 'prepared',
			paladin: 'prepared',
			ranger: 'prepared',
			sorcerer: 'prepared',
			warlock: 'prepared',
			wizard: 'spellbook',
		},
		// a class that casts nothing has nothing to cast as a ritual
		without: 'fighter',
	},
] as const)(
	'ritual casting as shipped ($pack)',
	({ system, pack, source, rituals, sources, without }) => {
		it('carries the SRD ritual tags, and each class says what it rituals from', async () => {
			const graph = await loadPacks(pack);
			expect(graph.list('spell', { system }).filter((r) => r.data.ritual)).toHaveLength(rituals);
			const stated = Object.fromEntries(
				graph
					.list('class', { system })
					.flatMap((r) => (r.data.ritual_source ? [[r.id, r.data.ritual_source]] : [])),
			);
			expect(stated).toEqual(sources);
		});

		it('a shipped wizard rituals Detect Magic unprepared; a shipped cleric only once prepared', async () => {
			const graph = await loadPacks(pack);
			const offered = (classId: string, prepared: boolean): boolean => {
				const c = newCharacter('probe', 'Probe', system);
				c.build.classes = [classRow({ class: `class:${source}:${classId}`, level: 3 })];
				c.build.spells = [
					{ spell: `spell:${source}:detect_magic`, prepared, alwaysPrepared: false },
				];
				const character = characterSchema.parse(c);
				const sheet = deriveSheet(character, graph);
				return buildSpellGroups({ character, sheet, graph, groupBy: 'level', pinned: {} })
					.flatMap((group) => group.rows)
					.some((row) => row.ritualCast);
			};
			expect(sources.wizard).toBe(RITUAL_SOURCE.spellbook);
			expect(offered('wizard', false)).toBe(true);
			expect(offered('cleric', false)).toBe(false);
			expect(offered('cleric', true)).toBe(true);
			expect(offered(without, true)).toBe(false);
		});
	},
);

/*
 * The two tails of the same rule. A FEAT that teaches a spell is a caster of its own: SRD 5.2.1's
 * Magic Initiate says "You always have that spell prepared", and the general rule lets any
 * spellcaster ritual a prepared spell — so the feat's row states `prepared`, and a Fighter who took
 * it rituals its spell. And whether a class KNOWS its spells or PREPARES them is each class's own
 * heading: SRD 5.1 prints "Spells Known of 1st Level and Higher" for four classes and "Preparing and
 * Casting Spells" for four; SRD 5.2.1 prints "Prepared Spells of Level 1+" for all eight.
 */
describe('how a class holds its spells, as shipped', () => {
	const stylesOf = async (pack: string, system: '5e' | '5.5e') =>
		Object.fromEntries(
			(await loadPacks(pack))
				.list('class', { system })
				.flatMap((r) => (r.data.prepare_style ? [[r.id, r.data.prepare_style]] : [])),
		);

	it('2014: four classes know their spells and four prepare them', async () => {
		expect(await stylesOf('srd-2014', '5e')).toEqual({
			bard: 'known',
			ranger: 'known',
			sorcerer: 'known',
			warlock: 'known',
			cleric: 'prepared',
			druid: 'prepared',
			paladin: 'prepared',
			wizard: 'prepared',
		});
	});

	it('2024: every caster class prepares', async () => {
		const styles = await stylesOf('srd-2024', '5.5e');
		expect(Object.keys(styles).sort()).toEqual(
			['bard', 'cleric', 'druid', 'paladin', 'ranger', 'sorcerer', 'warlock', 'wizard'].sort(),
		);
		expect(new Set(Object.values(styles))).toEqual(new Set(['prepared']));
	});

	it('2024 Magic Initiate rituals its own spell, on a character with no caster class', async () => {
		const source = 'SRD 5.2.1';
		const graph = await loadPacks('srd-2024');
		const feat = `feat:${source}:magic_initiate`;
		const row = graph.get(feat);
		expect(row?.type === 'feat' ? row.data.ritual_source : null).toBe(RITUAL_SOURCE.prepared);

		const c = newCharacter('probe', 'Probe', '5.5e');
		c.build.classes = [classRow({ class: `class:${source}:fighter`, level: 1 })];
		c.build.feats = [feat];
		c.build.featSpells = [{ feat, key: 'origin', list: 'wizard', ability: 'int' }];
		c.build.spells = [
			{ spell: `spell:${source}:detect_magic`, prepared: true, alwaysPrepared: false },
		];
		const character = characterSchema.parse(c);
		const sheet = deriveSheet(character, graph);
		expect(sheet.spellcasting.ritualCasting).toBe(true);
		const rows = buildSpellGroups({
			character,
			sheet,
			graph,
			groupBy: 'level',
			pinned: {},
		}).flatMap((group) => group.rows);
		expect(rows.map((r) => [r.id, r.ritualCast])).toEqual([['detect_magic', true]]);
	});
});
