/*
 * The two fixture builders every suite that needs content or a character was hand-rolling.
 *
 * Before these, `new MemoryStorage()` → `st.write('c/<table>_srd.csv', …)` → `loadContent(st, ['c'])`
 * appeared nine times in `character/derive.test.ts` alone and again across sheet-diff, build, combat,
 * picker, spell-picks and the content suites — around a thousand duplicated lines, and the single
 * largest source of duplication in the test suite (docs/tests-audit.md).
 */
import { MemoryStorage } from '$lib/storage/memory';
import { loadContent, type ContentGraph } from '$lib/content/loader';
import { characterSchema, newCharacter, type Character } from '$lib/character/schema';
import type { SYSTEMS } from '$lib/rules/pipeline';

/** The one content root these fixtures write into. Tests that reload name it themselves. */
export const TEST_CONTENT_ROOT = 'c';

/** CSV files by name. A row array is joined with newlines, which is how every call site writes them. */
export type ContentFiles = Record<string, string | readonly string[]>;

/** An in-memory content root holding `files`. Use when the test also needs the storage — to rewrite a
 *  file and reload, or to assert on what was written. Otherwise use {@link makeTempContentRoot}. */
export async function makeTempContentStorage(files: ContentFiles): Promise<MemoryStorage> {
	const storage = new MemoryStorage();
	for (const [name, body] of Object.entries(files)) {
		await storage.write(
			`${TEST_CONTENT_ROOT}/${name}`,
			typeof body === 'string' ? body : body.join('\n'),
		);
	}
	return storage;
}

/** The loaded graph for one in-memory content root. Throws on a load ERROR, so a typo in a fixture
 *  fails where it was written rather than as a puzzling assertion failure three lines later. */
export async function makeTempContentRoot(files: ContentFiles): Promise<ContentGraph> {
	const graph = await loadContent(await makeTempContentStorage(files), [TEST_CONTENT_ROOT]);
	const errors = graph.issues.filter((i) => i.level === 'error');
	if (errors.length > 0) {
		throw new Error(`fixture content failed to load:\n${errors.map((e) => e.message).join('\n')}`);
	}
	return graph;
}

/** A parsed character, defaults filled in. `build` and `play` are shallow-merged over a fresh one, so
 *  a test names only the fields it cares about and still gets a schema-valid character. */
export function buildCharacter(
	over: {
		id?: string;
		name?: string;
		system?: (typeof SYSTEMS)[number];
		build?: Partial<Character['build']>;
		play?: Partial<Character['play']>;
	} = {},
): Character {
	const character = newCharacter(over.id ?? 'test', over.name ?? 'Test', over.system ?? '5.5e');
	return characterSchema.parse({
		...character,
		build: { ...character.build, ...over.build },
		play: { ...character.play, ...over.play },
	});
}
