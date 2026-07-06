/*
 * Hoist helper: rename a class in a Svelte file's markup (class="…" tokens + class: directives) to a
 * new GLOBAL name, and DELETE its now-redundant local rule from the <style> block (the new name lives
 * in styles/components.css). Only handles flat rules (no nested braces) — enough for shell classes.
 *
 *   node tools/visual/hoist-class.mjs <file> old:newGlobal old:newGlobal ...
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [file, ...pairs] = process.argv.slice(2);
const map = pairs.map((p) => p.split(':'));
const src = readFileSync(file, 'utf8');

const styleM = src.match(/<style>([\s\S]*)<\/style>/);
let head = styleM ? src.slice(0, styleM.index) : src;
let style = styleM ? styleM[1] : '';
const tail = styleM ? src.slice(styleM.index + styleM[0].length) : '';

for (const [oldC, newC] of map) {
	// markup: class="…" tokens + class: directives → the new global name
	head = head.replace(
		/class="([^"]*)"/g,
		(_m, cls) =>
			`class="${cls
				.split(/\s+/)
				.map((t) => (t === oldC ? newC : t))
				.join(' ')}"`
	);
	head = head.replace(new RegExp(`class:${oldC}\\b`, 'g'), `class:${newC}`);
	// style: delete the local `.old { … }` flat rule (the new name is a global now)
	style = style.replace(new RegExp(`\\n\\t\\.${oldC}\\s*\\{[^{}]*\\}`, 'g'), '');
}

writeFileSync(file, styleM ? head + '<style>' + style + '</style>' + tail : head, 'utf8');
console.log('hoisted:', map.map(([a, b]) => `${a}→${b}`).join('  '), `(${file})`);
