/*
 * Every full-screen dialog carries the language switcher — `docs/internals/ui.md` ▸ "No exceptions".
 *
 * The rule exists because a modal's backdrop is a DISMISS target: while one is open the topbar's
 * switcher is not merely covered, reaching for it cancels the question. And the questions these ask
 * are the ones that cannot be taken back — a destructive confirm, a schema discard, a data-folder
 * migration. A reader who cannot follow the sentence must not have to dismiss it to change language.
 *
 * It is a test rather than a note because five dialogs were written against the same house template,
 * named it in their header comments, and missed the clause equally: a template that carries the look
 * without carrying the contract only fails where somebody remembers.
 *
 * Scoped to what the rule is about — a component that builds its own `.dialog-head`. Anything on
 * `DialogShell` inherits the corner and needs nothing of its own.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function componentsBuildingTheirOwnDialogHead(): string[] {
	return readdirSync(srcRoot, { recursive: true, encoding: 'utf8' })
		.filter((p) => p.endsWith('.svelte'))
		.map((p) => resolve(srcRoot, p))
		.filter((p) => readFileSync(p, 'utf8').includes('class="dialog-head"'))
		.map((p) => relative(srcRoot, p).replace(/\\/g, '/'));
}

describe('every dialog carries the language switcher', () => {
	it('there are dialogs to scan at all', () => {
		expect(componentsBuildingTheirOwnDialogHead().length).toBeGreaterThan(1);
	});

	it('…and each of them renders one in its corner', () => {
		const missing = componentsBuildingTheirOwnDialogHead().filter(
			(p) => !readFileSync(resolve(srcRoot, p), 'utf8').includes('dialog-lang-corner'),
		);
		expect(missing).toEqual([]);
	});
});
