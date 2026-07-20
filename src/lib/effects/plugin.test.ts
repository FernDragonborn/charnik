/*
 * PLG-1 behavioral tests — the registry seam + derive pre-pass with an INJECTED fake evaluator
 * (zero sandbox: proves the token grammar, host-side validation caps, memo economics, fail-closed
 * counter, and attribution rules from docs/PLUGINS.md §4 with no QuickJS in sight).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { parseToken, EFFECT_KIND, type ActiveEffect, type EffectIssue } from './token-parser';
import { applyEffects, collectFacts, mergeFacts } from './apply';
import { computed } from '../rules/pipeline';
import {
	expandPluginEffects,
	registerPluginEvaluator,
	clearPluginEvaluator,
	clearPluginMemo,
	type PluginCtx,
	type PluginEvaluator,
	type PluginTokenRef
} from './plugin-registry';

const ctx = (over?: { hp?: number }): PluginCtx => ({
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
			wis: { score: 12, mod: 1 },
			cha: { score: 8, mod: -1 }
		}
	},
	play: {
		hp: over?.hp ?? 41,
		hpMax: 58,
		tempHp: 0,
		flags: { isBloodied: false, isRaging: false, isConcentrating: false },
		conditions: [],
		resources: { grit: 2 }
	}
});

const carrier = (token: string, source = 'Ring of Testing'): ActiveEffect => ({
	source,
	layer: 'item',
	tokens: [token]
});

/** A fake evaluator: handlers keyed `namespace:handlerName`, returning the raw result object (JSON-ified here —
 *  the same single-string boundary the sandbox uses). Records every real call for memo asserts. */
function fakeEvaluator(
	handlers: Record<string, (token: PluginTokenRef, build: unknown, play: unknown) => unknown>,
	opts?: { readPlay?: boolean }
): PluginEvaluator & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		has: (namespace, handlerName) => Object.hasOwn(handlers, `${namespace}:${handlerName}`),
		call(token, buildJson, playJson) {
			calls.push(token.raw);
			const h = handlers[`${token.namespace}:${token.handlerName}`];
			if (!h) return { ok: false, reason: 'no handler' };
			try {
				const result = h(token, JSON.parse(buildJson), JSON.parse(playJson));
				return { ok: true, resultJson: JSON.stringify(result), readPlay: opts?.readPlay ?? false };
			} catch (e) {
				return { ok: false, reason: String(e) };
			}
		}
	};
}

beforeEach(() => {
	clearPluginEvaluator();
	clearPluginMemo();
});

describe('parseToken — the plugin: token grammar (PLUGINS.md §1)', () => {
	it('parses namespace/handlerName/args; args may contain further colons', () => {
		const p = parseToken('plugin:my-homebrew:exploit-die:d8@5,d10@11');
		expect(p.kind).toBe(EFFECT_KIND.plugin);
		expect(p.plugin).toEqual({
			namespace: 'my-homebrew',
			handlerName: 'exploit-die',
			args: 'd8@5,d10@11'
		});
		expect(parseToken('plugin:a:b:x:y:z').plugin?.args).toBe('x:y:z');
	});
	it('args are optional (empty string)', () => {
		expect(parseToken('plugin:ns1:grit-pool').plugin).toEqual({
			namespace: 'ns1',
			handlerName: 'grit-pool',
			args: ''
		});
	});
	it('rejects bad grammar as unknown (inert), never a partial parse', () => {
		for (const bad of [
			'plugin:only-ns', // no handlerName
			'plugin:Bad-Case:handlerName', // uppercase namespace
			'plugin:-lead:handlerName', // leading dash
			'plugin:ns_underscore:handlerName', // underscore not in grammar
			`plugin:${'a'.repeat(33)}:handlerName`, // namespace over 32
			`plugin:namespace:handlerName:${'x'.repeat(257)}` // args over 256
		])
			expect(parseToken(bad).kind, bad).toBe('unknown');
	});
});

describe('expandPluginEffects — availability degradation', () => {
	it('returns null when no plugin token is present (the zero-cost fast path)', () => {
		expect(expandPluginEffects([carrier('flat_bonus:ac+1')], ctx(), [])).toBeNull();
	});
	it('no evaluator registered → inert note + issue, sheet unbroken', () => {
		const issues: EffectIssue[] = [];
		const out = expandPluginEffects([carrier('plugin:ns1:fn1')], ctx(), issues);
		expect(out?.unknown).toEqual([{ source: 'Ring of Testing', token: 'plugin:ns1:fn1' }]);
		expect(issues[0]?.reason).toMatch(/not available/);
	});
	it('unknown namespace/handlerName → degrade with the troubleshooting reason', () => {
		registerPluginEvaluator(fakeEvaluator({}));
		const issues: EffectIssue[] = [];
		const out = expandPluginEffects([carrier('plugin:ns1:nope')], ctx(), issues);
		expect(out?.unknown.length).toBe(1);
		expect(issues[0]?.reason).toMatch(/missing\/disabled/);
	});
	it('a broken plugin surfaces its REAL load error, not a generic "not registered" (author DX)', () => {
		const ev: PluginEvaluator = {
			has: () => false,
			call: () => ({ ok: false, reason: 'n/a' }),
			loadError: () => 'main.js failed to load: SyntaxError: unexpected token'
		};
		registerPluginEvaluator(ev);
		const issues: EffectIssue[] = [];
		expandPluginEffects([carrier('plugin:ns1:h')], ctx(), issues);
		expect(issues[0]?.reason).toMatch(/SyntaxError/); // the author sees WHY, not a puzzle
	});
});

describe('the tokens dialect (§4.3) — returned L1 tokens ride the content machinery', () => {
	it('folds at the CARRYING effect layer with carrier·namespace attribution (§4.4a)', () => {
		registerPluginEvaluator(
			fakeEvaluator({
				'ns1:exploit-die': () => ({ tokens: ['flat_bonus:attack+1d8'], notes: ['Exploit die: d8'] })
			})
		);
		const out = expandPluginEffects([carrier('plugin:ns1:exploit-die:d8@5')], ctx(), []);
		expect(out?.syntheticEffects).toEqual([
			{ source: 'Ring of Testing · ns1', layer: 'item', tokens: ['flat_bonus:attack+1d8'] }
		]);
		expect(out?.notes).toEqual([{ source: 'Ring of Testing · ns1', text: 'Exploit die: d8' }]);
	});
	it('nested plugin: tokens are ignored (no recursion)', () => {
		registerPluginEvaluator(
			fakeEvaluator({ 'ns1:fn1': () => ({ tokens: ['plugin:ns1:fn1', 'flat_bonus:ac+1'] }) })
		);
		const out = expandPluginEffects([carrier('plugin:ns1:fn1')], ctx(), []);
		expect(out?.syntheticEffects[0]?.tokens).toEqual(['flat_bonus:ac+1']);
	});
	it('a `;` inside one token element rejects the WHOLE result (PLG-SEC 20)', () => {
		registerPluginEvaluator(
			fakeEvaluator({ 'ns1:fn1': () => ({ tokens: ['flat_bonus:ac+1;flat_bonus:ac+1'] }) })
		);
		const issues: EffectIssue[] = [];
		const out = expandPluginEffects([carrier('plugin:ns1:fn1')], ctx(), issues);
		expect(out?.syntheticEffects).toEqual([]);
		expect(issues[0]?.reason).toMatch(/invalid result/);
	});
	it('over 16 tokens rejects the whole result', () => {
		registerPluginEvaluator(
			fakeEvaluator({ 'ns1:fn1': () => ({ tokens: Array(17).fill('flat_bonus:ac+1') }) })
		);
		const out = expandPluginEffects([carrier('plugin:ns1:fn1')], ctx(), []);
		expect(out?.syntheticEffects).toEqual([]);
		expect(out?.unknown.length).toBe(1);
	});
	it('same token on TWO carriers: computed once (memo), applied per occurrence (§4.4a)', () => {
		const ev = fakeEvaluator({ 'ns1:fn1': () => ({ tokens: ['flat_bonus:ac+1'] }) });
		registerPluginEvaluator(ev);
		const out = expandPluginEffects(
			[carrier('plugin:ns1:fn1', 'Item A'), carrier('plugin:ns1:fn1', 'Item B')],
			ctx(),
			[]
		);
		expect(ev.calls.length).toBe(1);
		expect(out?.syntheticEffects.map((e) => e.source)).toEqual(['Item A · ns1', 'Item B · ns1']);
	});
});

describe('the contributions dialect (§4.3) — host-stamped pre-folded amounts', () => {
	it('produces numeric facts with ns-stamped provenance (PLG-SEC 16) that fold onto the stat', () => {
		registerPluginEvaluator(
			fakeEvaluator({
				'ns1:scaling-ward': (_t, build) => {
					const b = build as { level: number };
					return {
						contributions: {
							ac: [{ layer: 'feature', op: 'add', amount: Math.floor(b.level / 5), label: 'Ward' }]
						}
					};
				}
			})
		);
		const out = expandPluginEffects([carrier('plugin:ns1:scaling-ward')], ctx(), []);
		expect(out?.numeric).toEqual([
			{
				target: 'ac',
				op: 'add',
				layer: 'feature',
				source: 'ns1: Ward',
				token: 'plugin:ns1:scaling-ward',
				amount: 1
			}
		]);
		// end-to-end: the fact folds through the normal seam
		const facts = collectFacts([], undefined);
		facts.numeric.push(...(out?.numeric ?? []));
		const ac = applyEffects(
			'ac',
			computed([{ source: 'Base', layer: 'base', op: 'add', amount: 12 }]),
			facts
		);
		expect(ac.value).toBe(13);
		expect(ac.trace.some((c) => c.source === 'ns1: Ward')).toBe(true);
	});
	it('mult folds through the pipeline (op set/mult per §4.3)', () => {
		registerPluginEvaluator(
			fakeEvaluator({
				'ns1:fn1': () => ({
					contributions: { speed: [{ layer: 'condition', op: 'mult', amount: 2 }] }
				})
			})
		);
		const out = expandPluginEffects([carrier('plugin:ns1:fn1')], ctx(), []);
		const facts = collectFacts([], undefined);
		facts.numeric.push(...(out?.numeric ?? []));
		const speed = applyEffects(
			'speed',
			computed([{ source: 'Base', layer: 'base', op: 'add', amount: 30 }]),
			facts
		);
		expect(speed.value).toBe(60);
	});
	it.each([
		['host-reserved layer', { ac: [{ layer: 'override', op: 'set', amount: 20 }] }],
		['bad target key', { __proto__x: [{ layer: 'feature', op: 'add', amount: 1 }] }],
		['non-finite amount', { ac: [{ layer: 'feature', op: 'add', amount: null }] }],
		['amount over cap', { ac: [{ layer: 'feature', op: 'add', amount: 1001 }] }]
	])('%s rejects the whole result → inert note', (_name, contributions) => {
		registerPluginEvaluator(fakeEvaluator({ 'ns1:fn1': () => ({ contributions }) }));
		const issues: EffectIssue[] = [];
		const out = expandPluginEffects([carrier('plugin:ns1:fn1')], ctx(), issues);
		expect(out?.numeric).toEqual([]);
		expect(out?.unknown.length).toBe(1);
	});
	it('a wrong result shape names the OFFENDING field path, not a bare "Required" (author DX)', () => {
		// a contribution missing its `layer` — the author should be told WHERE
		registerPluginEvaluator(
			fakeEvaluator({ 'ns1:fn1': () => ({ contributions: { ac: [{ op: 'add', amount: 1 }] } }) })
		);
		const issues: EffectIssue[] = [];
		expandPluginEffects([carrier('plugin:ns1:fn1')], ctx(), issues);
		expect(issues[0]?.reason).toMatch(/contributions\.ac\.0\.layer|layer/);
	});
});

describe('memo economics (§4.2) — build/play hashed separately', () => {
	it('a build-only handler stays cache-hot across play-state changes', () => {
		const ev = fakeEvaluator(
			{ 'ns1:fn1': () => ({ tokens: ['flat_bonus:ac+1'] }) },
			{ readPlay: false }
		);
		registerPluginEvaluator(ev);
		expandPluginEffects([carrier('plugin:ns1:fn1')], ctx({ hp: 41 }), []);
		expandPluginEffects([carrier('plugin:ns1:fn1')], ctx({ hp: 12 }), []);
		expect(ev.calls.length).toBe(1);
	});
	it('a play-reading handler re-runs when play-state changes, memoizes when it does not', () => {
		const ev = fakeEvaluator({ 'ns1:fn1': () => ({}) }, { readPlay: true });
		registerPluginEvaluator(ev);
		expandPluginEffects([carrier('plugin:ns1:fn1')], ctx({ hp: 41 }), []);
		expandPluginEffects([carrier('plugin:ns1:fn1')], ctx({ hp: 41 }), []);
		expect(ev.calls.length).toBe(1);
		expandPluginEffects([carrier('plugin:ns1:fn1')], ctx({ hp: 12 }), []);
		expect(ev.calls.length).toBe(2);
	});
});

describe('fail-closed (§5) — 3 consecutive failures disable the plugin for the session', () => {
	it('stops calling after the third failure and reports the disabled state', () => {
		let n = 0;
		const ev: PluginEvaluator = {
			has: () => true,
			call: () => {
				n++;
				return { ok: false, reason: 'handler threw' };
			}
		};
		registerPluginEvaluator(ev);
		const issues: EffectIssue[] = [];
		for (let i = 0; i < 5; i++)
			expandPluginEffects([carrier('plugin:ns1:fn1')], ctx({ hp: i }), issues);
		expect(n).toBe(3);
		expect(issues.at(-1)?.reason).toMatch(/disabled after repeated failures/);
	});

	it('the counter is per (namespace, character): a fail on ONE character never disables another (PLG-3)', () => {
		let n = 0;
		const ev: PluginEvaluator = {
			has: () => true,
			call: () => (n++, { ok: false, reason: 'boom' })
		};
		registerPluginEvaluator(ev);
		const issues: EffectIssue[] = [];
		// character A → 3 fails → disabled for A (the 4th pass never calls)
		for (let i = 0; i < 4; i++)
			expandPluginEffects([carrier('plugin:ns1:fn1')], ctx({ hp: i }), issues, 'char-a');
		expect(n).toBe(3);
		// a DIFFERENT character has its own fresh counter → the plugin runs again
		expandPluginEffects([carrier('plugin:ns1:fn1')], ctx(), issues, 'char-b');
		expect(n).toBe(4);
	});

	it('a success resets the consecutive-failure streak (PLG-T2)', () => {
		let mode: 'fail' | 'ok' = 'fail';
		let n = 0;
		const ev: PluginEvaluator = {
			has: () => true,
			// readPlay:true so each distinct hp is its own memo key → every pass really calls
			call: () =>
				mode === 'fail'
					? (n++, { ok: false, reason: 'x' })
					: (n++, { ok: true, resultJson: '{}', readPlay: true })
		};
		registerPluginEvaluator(ev);
		const issues: EffectIssue[] = [];
		const run = (hp: number) =>
			expandPluginEffects([carrier('plugin:ns1:fn1')], ctx({ hp }), issues, 's');
		run(1); // fail 1
		run(2); // fail 2
		mode = 'ok';
		run(3); // success → streak reset to 0
		mode = 'fail';
		run(4); // fail 1 (post-reset)
		run(5); // fail 2 (post-reset) — never hits 3, so never disabled
		expect(n).toBe(5); // all five actually called; the success cleared the streak
	});

	it('aggregate budget: once the 20ms is spent, remaining uncached tokens degrade (PLG-4 boundary)', () => {
		const ev: PluginEvaluator = {
			has: () => true,
			call: () => {
				const end = performance.now() + 25; // one call burns the whole aggregate budget
				while (performance.now() < end) {
					/* spin */
				}
				return { ok: true, resultJson: '{}', readPlay: false };
			}
		};
		registerPluginEvaluator(ev);
		const issues: EffectIssue[] = [];
		const out = expandPluginEffects(
			[carrier('plugin:ns1:aaa'), carrier('plugin:ns1:bbb')],
			ctx(),
			issues,
			's'
		);
		// first token eats the budget; the second is degraded before its call
		expect(issues.some((i) => /budget/.test(i.reason))).toBe(true);
		expect(out?.unknown.some((u) => u.token === 'plugin:ns1:bbb')).toBe(true);
	});
});

describe('mergeFacts — plugin synthetic effects merge into the derive facts', () => {
	it('concats arrays, dedupes conditions, largest resource max wins', () => {
		const base = collectFacts([carrier('apply_condition:blessed')], undefined);
		const extra = collectFacts(
			[
				{
					source: 'X · ns1',
					layer: 'item',
					tokens: ['apply_condition:blessed', 'grant_resource:grit:4:short', 'flat_bonus:ac+1']
				}
			],
			undefined
		);
		mergeFacts(base, extra);
		expect(base.conditions).toEqual(['blessed']);
		expect(base.numeric.length).toBe(1);
		expect(base.resources.find((r) => r.id === 'grit')?.max).toBe(4);
	});
});
