/*
 * PLG performance guarantees. The philosophy: assert WORK DONE (sandbox-call counts, re-compute
 * counts), not wall-clock — work-count is what actually drives cost and is stable in CI, whereas a
 * ms threshold is flaky. The one wall-clock assert (a real QuickJS call) uses a generous ceiling
 * (the CALL_BUDGET) purely as a "not pathologically slow" floor. Numbers-for-eyeballing live in
 * plugin.bench.ts (run with `pnpm exec vitest bench`).
 */
import { pluginCtx, carrier } from '../../test-support/plugin-fixtures';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createSandboxEvaluator } from './plugin-sandbox';
import {
	expandPluginEffects,
	registerPluginEvaluator,
	clearPluginEvaluator,
	clearPluginMemo,
	type PluginEvaluator,
	type PluginTokenRef,
} from './plugin-registry';

const ctx = (hp = 41) => pluginCtx({ hp });

/** A minimal counting evaluator — records how many times `has`/`call` actually ran. */
function counting(
	result: (t: PluginTokenRef) => unknown,
	opts?: { readPlay?: boolean },
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
				readPlay: opts?.readPlay ?? false,
			};
		},
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
			},
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
				} } };`,
			},
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
