/*
 * The two fixture builders for any suite that needs a content graph or a character.
 *
 * Hand-rolling `new MemoryStorage()` → `st.write('c/<table>_srd.csv', …)` → `loadContent(st, ['c'])`
 * per case is the largest source of duplication this suite is capable of growing — it reached ~1 000
 * lines once. Reach for these instead (docs/internals/testing.md ▸ Fixtures = contract).
 */
import { MemoryStorage } from '$lib/storage/memory';
import { loadContent, type ContentGraph } from '$lib/content/loader';
import { characterSchema, newCharacter, type Character } from '$lib/character/schema';
import type { SYSTEMS } from '$lib/rules/pipeline';

/** The one content root these fixtures write into. */
const TEST_CONTENT_ROOT = 'c';

/** CSV files by name. A row array is joined with newlines, which is how every call site writes them. */
type ContentFiles = Record<string, string | readonly string[]>;

/** An in-memory content root holding `files`. */
async function makeTempContentStorage(files: ContentFiles): Promise<MemoryStorage> {
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
