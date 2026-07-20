/*
 * Plugin fixture-runner CLI (docs/PLUGINS.md §11) — runs YOUR handler in the REAL QuickJS sandbox
 * with the real budgets and the real host-side validation, then prints the validated result or the
 * exact rejection reason. This is the same code path the app's derive pre-pass uses, so "works
 * here" = "works on the sheet".
 *
 *   pnpm plugin:test <plugin-folder> --token "plugin:<namespace>:<handlerName>[:<args>]" [--ctx fixture.json]
 *
 * The folder must hold plugin.json + main.js. The optional fixture is a JSON file with the §4.2
 * shape ({ build: {...}, play: {...} } — either half may be omitted to keep the defaults below).
 */
import { readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { pluginManifestSchema } from '../src/lib/effects/plugin-host';
import { createSandboxEvaluator } from '../src/lib/effects/plugin-sandbox';
import {
	expandPluginEffects,
	registerPluginEvaluator,
	type PluginCtx
} from '../src/lib/effects/plugin-registry';
import { parseToken, EFFECT_KIND, type EffectIssue } from '../src/lib/effects/token-parser';

const DEFAULT_CTX: PluginCtx = {
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
		hp: 41,
		hpMax: 58,
		tempHp: 0,
		flags: { isBloodied: false, isRaging: false, isConcentrating: false },
		conditions: [],
		resources: { grit: 2 }
	}
};

function fail(msg: string): never {
	console.error(`✖ ${msg}`);
	process.exit(1);
}

function arg(flag: string): string | undefined {
	const i = process.argv.indexOf(flag);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

const dir = process.argv[2];
const rawToken = arg('--token');
if (!dir || dir.startsWith('--') || !rawToken)
	fail(
		'usage: pnpm plugin:test <plugin-folder> --token "plugin:<namespace>:<handlerName>[:<args>]" [--ctx fixture.json]'
	);

const parsed = parseToken(rawToken);
if (parsed.kind !== EFFECT_KIND.plugin || !parsed.plugin)
	fail(
		`"${rawToken}" is not a valid plugin token (grammar: plugin:<namespace>:<handlerName>[:<args>], docs/PLUGINS.md §1)`
	);

let manifestRaw: string;
let code: string;
try {
	manifestRaw = readFileSync(resolve(dir, 'plugin.json'), 'utf8');
	code = readFileSync(resolve(dir, 'main.js'), 'utf8');
} catch (e) {
	fail(`cannot read plugin.json / main.js under "${dir}": ${String(e)}`);
}

const manifest = pluginManifestSchema.safeParse(JSON.parse(manifestRaw));
if (!manifest.success) {
	const first = manifest.error.issues[0];
	fail(`plugin.json invalid: ${first ? `${first.path.join('.')} — ${first.message}` : 'shape'}`);
}
const folderNs = basename(resolve(dir));
if (manifest.data.namespace !== parsed.plugin.namespace)
	fail(
		`token namespace "${parsed.plugin.namespace}" ≠ manifest namespace "${manifest.data.namespace}"`
	);
if (manifest.data.namespace !== folderNs)
	console.warn(
		`⚠ folder name "${folderNs}" ≠ manifest namespace "${manifest.data.namespace}" — the app would reject this install`
	);

let ctx = DEFAULT_CTX;
const ctxPath = arg('--ctx');
if (ctxPath) {
	const over = JSON.parse(readFileSync(resolve(ctxPath), 'utf8')) as Partial<PluginCtx>;
	ctx = {
		api: 1,
		build: { ...DEFAULT_CTX.build, ...over.build },
		play: { ...DEFAULT_CTX.play, ...over.play }
	};
}

const evaluator = await createSandboxEvaluator([{ namespace: manifest.data.namespace, code }]);
if (!evaluator.has(parsed.plugin.namespace, parsed.plugin.handlerName))
	fail(
		`handler "${parsed.plugin.handlerName}" not registered — main.js failed to evaluate, or globalThis.handlers["${parsed.plugin.handlerName}"].passive is not a function`
	);
registerPluginEvaluator(evaluator);

const issues: EffectIssue[] = [];
const out = expandPluginEffects(
	[{ source: 'plugin-test', layer: 'feature', tokens: [rawToken] }],
	ctx,
	issues
);

if (issues.length) {
	console.error(`✖ rejected: ${issues[0]?.reason}`);
	evaluator.dispose();
	process.exit(1);
}

console.log('✔ valid result\n');
if (out?.syntheticEffects.length)
	console.log(
		'tokens (fold at the carrier layer):',
		out.syntheticEffects.flatMap((e) => e.tokens)
	);
if (out?.numeric.length)
	console.log(
		'contributions:',
		out.numeric.map((n) => `${n.target} ${n.op} ${n.amount} @${n.layer} (${n.source})`)
	);
if (out?.notes.length)
	console.log(
		'notes:',
		out.notes.map((n) => n.text)
	);
if (!out?.syntheticEffects.length && !out?.numeric.length && !out?.notes.length)
	console.log('(empty result — "nothing applies")');
evaluator.dispose();
