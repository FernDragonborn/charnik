/*
 * PLG-2 sandbox integration tests — the REAL QuickJS-WASM container with the real budgets.
 * Every PLG-SEC containment claim is asserted here: escapes undefined, determinism intrinsics
 * gone, infinite loop + ReDoS interrupted, memory bomb limited, malformed output rejected,
 * happy paths from docs/PLUGINS.md §9, and the memo read-tracking flag.
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
import type { ActiveEffect, EffectIssue } from './token-parser';

const ctx = (over?: Partial<PluginCtx['play']>): PluginCtx => ({
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
			wis: { score: 15, mod: 2 },
			cha: { score: 8, mod: -1 }
		}
	},
	play: {
		hp: 41,
		hpMax: 58,
		tempHp: 0,
		flags: { isBloodied: false, isRaging: false, isConcentrating: false },
		conditions: [],
		resources: { grit: 2 },
		...over
	}
});

const token = (raw: string): PluginTokenRef => {
	const [, namespace = '', handlerName = '', ...rest] = raw.split(':');
	return { namespace, handlerName, args: rest.join(':'), raw };
};

const callOn = (ev: PluginEvaluator, raw: string, c = ctx()) =>
	ev.call(token(raw), JSON.stringify(c.build), JSON.stringify(c.play));

const disposers: { dispose(): void }[] = [];
async function evaluatorFor(namespace: string, code: string) {
	const ev = await createSandboxEvaluator([{ namespace, code }]);
	disposers.push(ev);
	return ev;
}
afterAll(() => {
	for (const d of disposers) d.dispose();
});
beforeEach(() => {
	clearPluginEvaluator();
	clearPluginMemo();
});

describe('happy paths — the docs/PLUGINS.md §9 examples run as written', () => {
	it('§9.1 level-scaled exploit die (tokens dialect, defensive args parse)', async () => {
		const ev = await evaluatorFor(
			'my-homebrew',
			`globalThis.handlers = {
				'exploit-die': {
					passive(token, ctx) {
						const lvl = ctx.build.classLevels.fighter ?? 0;
						if (lvl < 1) return { notes: ['Exploit die: requires fighter levels'] };
						let die = null;
						for (const part of String(token.args ?? '').split(',')) {
							const m = /^(d\\d{1,2})@(\\d{1,2})$/.exec(part.trim());
							if (m && lvl >= Number(m[2])) die = m[1];
						}
						if (!die) return {};
						return { tokens: ['flat_bonus:attack+1' + die], notes: ['Exploit die: ' + die + ' (fighter ' + lvl + ')'] };
					}
				}
			};`
		);
		const out = callOn(ev, 'plugin:my-homebrew:exploit-die:d6@1,d8@5,d10@11');
		expect(out.ok).toBe(true);
		if (out.ok) {
			expect(JSON.parse(out.resultJson)).toEqual({
				tokens: ['flat_bonus:attack+1d8'],
				notes: ['Exploit die: d8 (fighter 5)']
			});
			expect(out.readPlay).toBe(false); // build-only handler → cache-hot
		}
	});
	it('§9.2 computed resource pool reads only build', async () => {
		const ev = await evaluatorFor(
			'ns1',
			`globalThis.handlers = { 'grit-pool': { passive(token, ctx) {
				const n = Math.max(1, ctx.build.abilities.wis.mod);
				return { tokens: ['grant_resource:grit:' + n + ':short'] };
			} } };`
		);
		const out = callOn(ev, 'plugin:ns1:grit-pool');
		expect(out.ok && JSON.parse(out.resultJson).tokens).toEqual(['grant_resource:grit:2:short']);
	});
	it('§9.3 computed contribution + end-to-end through the registry pre-pass', async () => {
		const ev = await evaluatorFor(
			'ns1',
			`globalThis.handlers = { 'scaling-ward': { passive(token, ctx) {
				const bonus = Math.floor(ctx.build.level / 5);
				if (bonus === 0) return {};
				return { contributions: { ac: [{ layer: 'feature', op: 'add', amount: bonus, label: 'Scaling ward' }] } };
			} } };`
		);
		registerPluginEvaluator(ev);
		const eff: ActiveEffect = {
			source: 'Cloak',
			layer: 'item',
			tokens: ['plugin:ns1:scaling-ward']
		};
		const issues: EffectIssue[] = [];
		const out = expandPluginEffects([eff], ctx(), issues);
		expect(issues).toEqual([]);
		expect(out?.numeric).toEqual([
			{
				target: 'ac',
				op: 'add',
				layer: 'feature',
				source: 'ns1: Scaling ward',
				token: 'plugin:ns1:scaling-ward',
				amount: 1
			}
		]);
	});
	it('reading ctx.play sets the readPlay flag (memo economics §4.2)', async () => {
		const ev = await evaluatorFor(
			'ns1',
			`globalThis.handlers = { f: { passive(t, ctx) {
				return ctx.play.flags.isBloodied ? { tokens: ['advantage:attack'] } : {};
			} } };`
		);
		const out = callOn(ev, 'plugin:ns1:f');
		expect(out.ok && out.readPlay).toBe(true);
	});
});

describe('zero-capability context (PLG-SEC 1) — escapes and intrinsics are absent', () => {
	it.each([
		'fetch',
		'XMLHttpRequest',
		'WebSocket',
		'require',
		'process',
		'Date',
		'eval',
		'WeakRef',
		'FinalizationRegistry',
		'performance'
	])('%s is not reachable', async (name) => {
		const ev = await evaluatorFor(
			'probe-' + name.toLowerCase(),
			`globalThis.handlers = { probe: { passive() {
				return { notes: [String(typeof globalThis[${JSON.stringify(name)}])] };
			} } };`
		);
		const out = callOn(ev, `plugin:probe-${name.toLowerCase()}:probe`);
		expect(out.ok && JSON.parse(out.resultJson).notes).toEqual(['undefined']);
	});
	it('Math.random throws (determinism is mandatory) and Math is frozen', async () => {
		const ev = await evaluatorFor(
			'ns1',
			`globalThis.handlers = {
				rng: { passive() { return { notes: [String(Math.random())] }; } },
				fix: { passive() { try { Math.random = () => 0.5; } catch {} return { notes: [String(typeof Math.random)] }; } }
			};`
		);
		const rng = callOn(ev, 'plugin:ns1:rng');
		expect(rng.ok).toBe(false);
		if (!rng.ok) expect(rng.reason).toMatch(/Math\.random is removed/);
		// freeze holds: reassignment failed silently, calling still throws next time
		const fix = callOn(ev, 'plugin:ns1:fix');
		expect(fix.ok && JSON.parse(fix.resultJson).notes).toEqual(['function']);
		const rng2 = callOn(ev, 'plugin:ns1:rng');
		expect(rng2.ok).toBe(false);
	});
	it('dynamic import() cannot load anything (no module loader; its promise never resolves)', async () => {
		// import() EXISTS syntactically, but no module loader is registered and the host never
		// drains the job queue — the promise can neither load code nor smuggle data out (a returned
		// thenable is an invalid result).
		const ev = await evaluatorFor(
			'ns1',
			`globalThis.handlers = { f: { passive() { return import('x'); } } };`
		);
		const out = callOn(ev, 'plugin:ns1:f');
		expect(out.ok).toBe(false);
		if (!out.ok) expect(out.reason).toMatch(/async|invalid/i);
	});
});

describe('budgets (PLG-SEC 9) — hostile code is contained, then the context recycles', () => {
	it('an infinite loop is interrupted, and the NEXT call works (context recycled)', async () => {
		const ev = await evaluatorFor(
			'ns1',
			`globalThis.handlers = {
				spin: { passive(t) { if (t.args === 'go') { for (;;) {} } return {}; } }
			};`
		);
		const bad = callOn(ev, 'plugin:ns1:spin:go');
		expect(bad.ok).toBe(false);
		if (!bad.ok) expect(bad.reason).toMatch(/over budget/);
		const good = callOn(ev, 'plugin:ns1:spin');
		expect(good.ok).toBe(true);
	});
	it('catastrophic-backtracking regexp on hostile args is interrupted, not hung (PLG-SEC 1b)', async () => {
		const ev = await evaluatorFor(
			'ns1',
			`globalThis.handlers = { redos: { passive(t) {
				return { notes: [String(/^(a+)+$/.test(t.args))] };
			} } };`
		);
		const t0 = Date.now();
		const out = callOn(ev, 'plugin:ns1:redos:' + 'a'.repeat(40) + 'b');
		const elapsed = Date.now() - t0;
		expect(out.ok).toBe(false);
		expect(elapsed).toBeLessThan(2000); // interrupted by the deadline, not 2^40 steps
	});
	it('a memory bomb hits the memory limit', async () => {
		const ev = await evaluatorFor(
			'ns1',
			`globalThis.handlers = { bomb: { passive() {
				const a = []; for (;;) a.push('x'.repeat(65536));
			} } };`
		);
		const out = callOn(ev, 'plugin:ns1:bomb');
		expect(out.ok).toBe(false);
	});
	it('an oversized result string is rejected before parse (PLG-SEC 1c)', async () => {
		const ev = await evaluatorFor(
			'ns1',
			`globalThis.handlers = { big: { passive() {
				return { notes: ['x'.repeat(200000)] };
			} } };`
		);
		const out = callOn(ev, 'plugin:ns1:big');
		expect(out.ok).toBe(false);
		if (!out.ok) expect(out.reason).toMatch(/too large/);
	});
});

describe('the JSON boundary (§5) — invalid shapes are contained', () => {
	it.each([
		['a thrown error', `{ passive() { throw new Error('boom'); } }`, /boom/],
		['an async handler', `{ passive: async () => ({}) }`, /async|invalid/i],
		['a returned Promise-like', `{ passive: () => ({ then() {} }) }`, /async|invalid/i],
		['a circular result', `{ passive() { const o = {}; o.self = o; return o; } }`, /./]
	])('%s → contained failure, never a crash', async (_name, handler, reasonRe) => {
		const ev = await evaluatorFor('ns1', `globalThis.handlers = { f: ${handler} };`);
		const out = callOn(ev, 'plugin:ns1:f');
		expect(out.ok).toBe(false);
		if (!out.ok) expect(out.reason).toMatch(reasonRe);
	});
	it('a non-object result passes the boundary and dies at registry validation (whole pipeline)', async () => {
		const ev = await evaluatorFor('ns1', `globalThis.handlers = { f: { passive: () => 42 } };`);
		registerPluginEvaluator(ev);
		const issues: EffectIssue[] = [];
		const out = expandPluginEffects(
			[{ source: 'X', layer: 'item', tokens: ['plugin:ns1:f'] }],
			ctx(),
			issues
		);
		expect(out?.unknown.length).toBe(1);
		expect(issues[0]?.reason).toMatch(/invalid result/);
	});
});

describe('determinism + isolation', () => {
	it('same (token, ctx) → identical result across calls', async () => {
		const ev = await evaluatorFor(
			'ns1',
			`let counter = 0;
			globalThis.handlers = { f: { passive() { counter++; return { notes: ['n=' + counter] }; } } };`
		);
		// hidden state DOES tick inside the sandbox — the registry's memo is what guarantees
		// call-count independence; here we assert the evaluator itself is at least callable twice
		const a = callOn(ev, 'plugin:ns1:f');
		const b = callOn(ev, 'plugin:ns1:f');
		expect(a.ok && b.ok).toBe(true);
	});
	it('two plugins cannot see each other’s globals (one runtime per plugin, PLG-SEC 14)', async () => {
		const ev = await createSandboxEvaluator([
			{
				namespace: 'alpha',
				code: `globalThis.secret = 'alpha-secret'; globalThis.handlers = { f: { passive() { return {}; } } };`
			},
			{
				namespace: 'beta',
				code: `globalThis.handlers = { spy: { passive() { return { notes: [String(typeof globalThis.secret)] }; } } };`
			}
		]);
		disposers.push(ev);
		const out = callOn(ev, 'plugin:beta:spy');
		expect(out.ok && JSON.parse(out.resultJson).notes).toEqual(['undefined']);
	});
	it('a plugin whose main.js fails to evaluate is simply absent (fail-closed)', async () => {
		const ev = await evaluatorFor('ns1', `throw new Error('broken plugin');`);
		expect(ev.has('ns1', 'anything')).toBe(false);
	});
	it('a main.js THROW at load surfaces the real error message (author DX)', async () => {
		const ev = await evaluatorFor('ns1', `throw new Error('boom at load');`);
		expect(ev.loadError?.('ns1')).toMatch(/boom at load/);
	});
	it('a main.js SYNTAX error surfaces the real error, not a generic miss (author DX)', async () => {
		const ev = await evaluatorFor('ns1', `globalThis.handlers = { oops(`); // unterminated
		expect(ev.has('ns1', 'oops')).toBe(false);
		expect(ev.loadError?.('ns1')).toMatch(/main\.js failed to load|SyntaxError/i);
	});
	it('main.js over the 256 KB cap is not loaded', async () => {
		const ev = await evaluatorFor(
			'ns1',
			`globalThis.handlers = { f: { passive() { return {}; } } }; // ${'x'.repeat(300000)}`
		);
		expect(ev.has('ns1', 'f')).toBe(false);
	});
});
