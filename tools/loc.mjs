/*
 * Lines of CODE per file — the number the size rules actually judge, not `wc -l`.
 *
 * Two metrics, because the repo has two kinds of file (AI-CONVENTIONS §2.6):
 *  - `.ts` → non-blank, non-comment lines, counted the same way eslint's `max-lines`
 *    (`skipBlankLines` + `skipComments`, threshold 400) does, so this agrees with the gate instead
 *    of offering a second opinion.
 *  - `.svelte` → the same count over the `<script>` blocks ONLY. A component's total is mostly
 *    markup and CSS, so counting it measures the wrong thing — a 575-line RollRow is fine, a
 *    550-line layout carrying 221 lines of script is not.
 *
 * Usage: node tools/loc.mjs [--all] [glob-ish path prefix …]
 *        pnpm loc            → everything over the threshold, worst first
 *        pnpm loc --all      → every file, worst first
 *        pnpm loc --verify   → assert the counts still equal eslint's (the tool's whole contract)
 */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const TS_LIMIT = 400;
/** No eslint rule governs component script size; this is the review threshold §2.6 describes. */
const SVELTE_SCRIPT_LIMIT = 150;

/** Non-blank, non-comment lines. Block comments are tracked across lines; a `//` only counts as a
 *  comment when it STARTS the line, so trailing comments still count their code (as eslint does). */
function codeLines(source) {
	let count = 0;
	let inBlock = false;
	for (const raw of source.split('\n')) {
		let line = raw.trim();
		if (inBlock) {
			const end = line.indexOf('*/');
			if (end === -1) continue;
			inBlock = false;
			line = line.slice(end + 2).trim();
		}
		while (line.includes('/*')) {
			const start = line.indexOf('/*');
			const end = line.indexOf('*/', start + 2);
			if (end === -1) {
				inBlock = true;
				line = line.slice(0, start).trim();
				break;
			}
			line = (line.slice(0, start) + line.slice(end + 2)).trim();
		}
		if (line === '' || line.startsWith('//')) continue;
		count++;
	}
	return count;
}

/** For a component, only the `<script>` bodies — the logic, which is what belongs in a view-model. */
const scriptOf = (source) =>
	[...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

const files = [];
const walk = (dir) => {
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) walk(p);
		else if (/\.(ts|svelte)$/.test(entry) && !entry.endsWith('.test.ts')) files.push(p);
	}
};
walk('src');

const args = process.argv.slice(2);
const showAll = args.includes('--all');
const prefixes = args.filter((a) => !a.startsWith('--'));

const rows = files
	.filter((f) => prefixes.length === 0 || prefixes.some((p) => f.replace(/\\/g, '/').includes(p)))
	.map((file) => {
		const source = readFileSync(file, 'utf8');
		const svelte = file.endsWith('.svelte');
		return {
			file: file.replace(/\\/g, '/').replace(/^src\//, ''),
			code: codeLines(svelte ? scriptOf(source) : source),
			total: source.split('\n').length,
			limit: svelte ? SVELTE_SCRIPT_LIMIT : TS_LIMIT,
			svelte,
		};
	})
	.sort((a, b) => b.code - a.code);

/* The contract is "same number as the gate", so it is checkable rather than believed: ask eslint
   what it counted and compare. Only files OVER the limit appear in its report, which is enough —
   they are the ones anybody quotes. */
if (args.includes('--verify')) {
	const report = JSON.parse(execSync('npx eslint . -f json', { encoding: 'utf8', maxBuffer: 1e8 }));
	const mine = new Map(rows.map((r) => [r.file, r.code]));
	let checked = 0;
	let bad = 0;
	for (const file of report) {
		for (const message of file.messages) {
			if (message.ruleId !== 'max-lines') continue;
			const theirs = Number(/has too many lines \((\d+)\)/.exec(message.message)[1]);
			const rel = file.filePath.replace(/\\/g, '/').split('/src/')[1];
			checked++;
			if (mine.get(rel) !== theirs) {
				console.error(`MISMATCH ${rel}: eslint ${theirs}, loc ${mine.get(rel)}`);
				bad++;
			}
		}
	}
	console.log(`${checked} files cross-checked against eslint's max-lines, ${bad} mismatches`);
	process.exit(bad === 0 ? 0 : 1);
}

const over = rows.filter((r) => r.code > r.limit);
const shown = showAll ? rows : over;
console.log(' code  total  file');
for (const r of shown)
	console.log(
		`${String(r.code).padStart(5)}  ${String(r.total).padStart(5)}  ${r.file}${r.svelte ? '  (script only)' : ''}`,
	);
// counted over the WHOLE selection, not over what got printed: under `--all` those differ, and the
// summary line is the number people quote
if (over.length === 0) console.log('  — nothing over the threshold');
else
	console.log(
		`\n${over.length} over the threshold (ts ${TS_LIMIT}, svelte script ${SVELTE_SCRIPT_LIMIT})`,
	);
