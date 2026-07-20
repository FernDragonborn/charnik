/*
 * PLG performance guarantees. The philosophy: assert WORK DONE (sandbox-call counts, re-compute
 * counts), not wall-clock — work-count is what actually drives cost and is stable in CI, whereas a
 * ms threshold is flaky. The one wall-clock assert (a real QuickJS call) uses a generous ceiling
 * (the CALL_BUDGET) purely as a "not pathologically slow" floor. Numbers-for-eyeballing live in
 * plugin.bench.ts (run with `pnpm exec vitest bench`).
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createSandboxEvaluator } from './plugin-sandbox';
import {
	expandPluginEffects,
	registerPluginEvaluator,
	clearPluginEvaluator,
	clearPluginMemo,
	type PluginCtx,
	type PluginEvaluator,
	type PluginTokenRef
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

/** A minimal counting evaluator — records how many times `has`/`call` actually ran. */
function counting(
	result: (t: PluginTokenRef) => unknown,
	opts?: { readPlay?: boolean }
): PluginEvaluator & { calls: number; hasCalls: number } {
	const ev = {
		calls: 0,
		hasCalls: 0,
		has(_namespace: string, _handlerName: string) {
			ev.hasCalls++;
			return true;
		},
		call(token: PluginTokenRef) {
			ev.calls++;
			return {
				ok: true as const,
				resultJson: JSON.stringify(result(token)),
				readPlay: opts?.readPlay ?? false
			};
		}
	};
	return ev;
}

beforeEach(() => {
	clearPluginEvaluator();
	clearPluginMemo();
});

describe('L3 hot-path cost guarantees (work-count, not wall-clock)', () => {
	it('the zero-plugin fast path never touches the evaluator, even over a big effect list', () => {
		const ev = counting(() => ({}));
		registerPluginEvaluator(ev);
		const effects = Array.from({ length: 200 }, (_, i) => carrier(`flat_bonus:ac+${i % 3}`));
		for (let i = 0; i < 50; i++) expect(expandPluginEffects(effects, ctx(i), [])).toBeNull();
		expect(ev.hasCalls).toBe(0);
		expect(ev.calls).toBe(0); // no plugin token → returns null before any evaluator work
	});

	it('a build-only handler is computed ONCE across 500 play-state changes (§4.2 memo)', () => {
		const ev = counting(() => ({ tokens: ['flat_bonus:ac+1'] }), { readPlay: false });
		registerPluginEvaluator(ev);
		for (let hp = 0; hp < 500; hp++) expandPluginEffects([carrier('plugin:ns1:h')], ctx(hp), []);
		expect(ev.calls).toBe(1); // every HP tick is a cache hit — the point of the build/play split
	});

	it('the same token on 100 carriers computes once, folds per occurrence', () => {
		const ev = counting(() => ({ tokens: ['flat_bonus:ac+1'] }));
		registerPluginEvaluator(ev);
		const carriers = Array.from({ length: 100 }, (_, i) => carrier('plugin:ns1:h', `Item${i}`));
		const out = expandPluginEffects(carriers, ctx(), []);
		expect(ev.calls).toBe(1);
		expect(out?.syntheticEffects.length).toBe(100);
	});

	it('a play-reading handler re-runs only on DISTINCT play states, not every derive', () => {
		const ev = counting(() => ({}), { readPlay: true });
		registerPluginEvaluator(ev);
		// 5 distinct HP values, each derived 20× → exactly 5 real calls
		for (let round = 0; round < 20; round++)
			for (const hp of [1, 2, 3, 4, 5]) expandPluginEffects([carrier('plugin:ns1:h')], ctx(hp), []);
		expect(ev.calls).toBe(5);
	});

	it('the aggregate budget bounds sandbox calls per derive (a flood cannot run unbounded)', () => {
		let calls = 0;
		const ev: PluginEvaluator = {
			has: () => true,
			call: () => {
				calls++;
				const end = performance.now() + 6; // each call eats ~6ms of the 20ms budget
				while (performance.now() < end) {
					/* spin */
				}
				return { ok: true, resultJson: '{}', readPlay: false };
			}
		};
		registerPluginEvaluator(ev);
		const carriers = Array.from({ length: 50 }, (_, i) => carrier(`plugin:ns1:h${i}`));
		const issues: { source: string; token: string; reason: string }[] = [];
		expandPluginEffects(carriers, ctx(), issues, 's');
		expect(calls).toBeLessThanOrEqual(6); // ~20ms / 6ms → a handful, never all 50
		expect(issues.length).toBeGreaterThan(40); // the remainder degraded, sheet unbroken
	});
});

describe('real QuickJS throughput (generous wall-clock floor)', () => {
	const disposers: { dispose(): void }[] = [];
	afterAll(() => {
		for (const d of disposers) d.dispose();
	});
	const ref = (raw: string): PluginTokenRef => {
		const [, namespace = '', handlerName = '', ...rest] = raw.split(':');
		return { namespace, handlerName, args: rest.join(':'), raw };
	};

	it('a real arithmetic handler call stays well under the 5ms CALL_BUDGET', async () => {
		const ev = await createSandboxEvaluator([
			{
				namespace: 'ns1',
				code: `globalThis.handlers = { h: { passive(t, ctx) {
					return { contributions: { ac: [{ layer: 'item', op: 'add', amount: ctx.build.level }] } };
				} } };`
			}
		]);
		disposers.push(ev);
		const b = JSON.stringify(ctx().build);
		const p = JSON.stringify(ctx().play);
		ev.call(ref('plugin:ns1:h'), b, p); // warm the context
		const N = 200;
		const t0 = performance.now();
		for (let i = 0; i < N; i++) ev.call(ref('plugin:ns1:h'), b, p);
		const perCall = (performance.now() - t0) / N;
		expect(perCall).toBeLessThan(5); // typically << 1ms; the ceiling only catches a pathology
	});
});
