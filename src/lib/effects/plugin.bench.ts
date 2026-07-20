/*
 * PLG micro-benchmarks — numbers for eyeballing, NOT a CI gate (run: `pnpm exec vitest bench`).
 * The gating regression guarantees are work-count asserts in plugin-perf.test.ts; this file reports
 * throughput of the two pure-JS cost paths that run on the derive hot line in BOTH the node and web
 * builds: the zero-plugin fast path (hit on EVERY derive by every user) and a memo hit (build-only
 * handler across play ticks). The real QuickJS per-call cost is asserted in plugin-perf.test.ts
 * (node-only — the sync-WASM sandbox never loads in a browser, PLG-SEC 21).
 */
import { bench, describe, beforeAll } from 'vitest';
import {
	expandPluginEffects,
	registerPluginEvaluator,
	clearPluginMemo,
	type PluginCtx,
	type PluginEvaluator
} from './plugin-registry';
import type { ActiveEffect } from './token-parser';

const ctx = (hp = 41): PluginCtx => ({
	api: 1,
	build: {
		system: '5e',
		level: 7,
		classLevels: { fighter: 5 },
		proficiencyBonus: 3,
		abilities: {
			str: { score: 16, mod: 3 },
			dex: { score: 14, mod: 2 },
			con: { score: 14, mod: 2 },
			int: { score: 10, mod: 0 },
			wis: { score: 12, mod: 1 },
			cha: { score: 8, mod: -1 }
		}
	},
	play: {
		hp,
		hpMax: 58,
		tempHp: 0,
		flags: { isBloodied: false, isRaging: false, isConcentrating: false },
		conditions: [],
		resources: { grit: 2 }
	}
});
const carrier = (token: string, source = 'Ring'): ActiveEffect => ({
	source,
	layer: 'item',
	tokens: [token]
});
const buildOnly: PluginEvaluator = {
	has: () => true,
	call: () => ({
		ok: true,
		resultJson: JSON.stringify({ tokens: ['flat_bonus:ac+1'] }),
		readPlay: false
	})
};

describe('expandPluginEffects pre-pass', () => {
	const noPlugin = Array.from({ length: 50 }, (_, i) => carrier(`flat_bonus:ac+${i % 3}`));
	bench('fast path — 50 effects, no plugin token → null', () => {
		expandPluginEffects(noPlugin, ctx(), []);
	});

	const oneToken = [carrier('plugin:ns1:h')];
	beforeAll(() => {
		registerPluginEvaluator(buildOnly);
		clearPluginMemo();
		expandPluginEffects(oneToken, ctx(), []); // warm the memo
	});
	bench('memo hit — build-only handler, re-derive same ctx', () => {
		expandPluginEffects(oneToken, ctx(), []);
	});
});
