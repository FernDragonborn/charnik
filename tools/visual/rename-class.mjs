/*
 * Safe CSS-class renamer for a Svelte file. Renames class names ONLY where they are actually classes:
 *   1. `class="a b c"` attribute tokens (whole-word), 2. `class:name` directives,
 *   3. `.name` selectors inside the `<style>` block.
 * The `<script>` block and template `{...}` JS expressions are left untouched — so a class name that
 * collides with a JS property (.hp, .cur, .val…) is renamed as a class without breaking the code.
 *
 *   node tools/visual/rename-class.mjs <file> old:new old:new ...
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [file, ...pairs] = process.argv.slice(2);
const map = pairs.map((p) => p.split(':'));
const src = readFileSync(file, 'utf8');

const styleM = src.match(/<style>([\s\S]*)<\/style>/);
let head = styleM ? src.slice(0, styleM.index) : src; // <script> + template
let style = styleM ? styleM[1] : '';
const tail = styleM ? src.slice(styleM.index + styleM[0].length) : '';

for (const [oldC, newC] of map) {
	// class="..." attribute tokens (exact token, so JS never matches)
	head = head.replace(
		/class="([^"]*)"/g,
		(_m, cls) =>
			`class="${cls
				.split(/\s+/)
				.map((t) => (t === oldC ? newC : t))
				.join(' ')}"`
	);
	// class:old  Svelte directive
	head = head.replace(new RegExp(`class:${oldC}\\b`, 'g'), `class:${newC}`);
	// .old selectors — ONLY in the <style> block
	style = style.replace(new RegExp(`\\.${oldC}\\b`, 'g'), `.${newC}`);
}

writeFileSync(file, styleM ? head + '<style>' + style + '</style>' + tail : head, 'utf8');
console.log('renamed:', map.map(([a, b]) => `${a}→${b}`).join('  '));
