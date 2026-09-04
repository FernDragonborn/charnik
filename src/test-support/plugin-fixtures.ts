/*
 * The plugin-host fixtures the three PLG suites each hand-rolled: a `PluginCtx` at a fixed level and
 * ability spread, and an effect carrying one token. Kept out of `fixtures.ts` so nothing outside the
 * effects tests imports the effects module by accident — the engine is removable by design.
 */
import type { PluginCtx } from '$lib/effects/plugin-registry';
import type { ActiveEffect } from '$lib/effects/token-parser';

/** A level-7 fighter/rogue with a WIS mod of +2 — the shape every plugin handler in the tests reads.
 *  `play` is merged over the defaults, which is the half that varies (hp drives the §4.2 memo split). */
export const pluginCtx = (play: Partial<PluginCtx['play']> = {}): PluginCtx => ({
	api: 1,
	build: {
		system: '5e',
		level: 7,
		classLevels: { fighter: 5, rogue: 2 },
		proficiencyBonus: 3,
		abilities: {
			str: { score: 16, mod: 3 },
			dex: { score: 14, mod: 2 },
			con: { score: 14, mod: 2 },
			int: { score: 10, mod: 0 },
			wis: { score: 15, mod: 2 },
			cha: { score: 8, mod: -1 },
		},
	},
	play: {
		hp: 41,
		hpMax: 58,
		tempHp: 0,
		flags: { isBloodied: false, isRaging: false, isConcentrating: false },
		conditions: [],
		resources: { grit: 2 },
		...play,
	},
});

/** An item-layer effect carrying one token — the thing a plugin token rides in on. */
export const carrier = (token: string, source = 'Ring of Testing'): ActiveEffect => ({
	source,
	layer: 'item',
	tokens: [token],
});
