import { describe, expect, it } from 'vitest';
import { fileHashState } from './hash';
import { HASH_STATE, parseContentDirectives } from './meta';
import { restampFiles, restampText } from './restamp';
import { MemoryStorage } from '$lib/storage/memory';
import { loadContent } from './loader';

const LF_BODY = 'id,name_en\nfireball,Fireball\nshield,Shield';
const lf = (...header: string[]) => `${header.join('\n')}\n${LF_BODY}`;
const crlfBom = (...header: string[]) =>
	String.fromCharCode(0xfeff) + [...header, ...LF_BODY.split('\n')].join('\r\n');

const STAMPED = lf(
	'#content-hash: xxh64:0000000000000000',
	'#content-source: SRD 5.2.1',
	'#content-license: CC-BY-4.0',
	'#content-updated_at: 2020-01-01',
);

/* Assigning a type is the content-health panel's one repair action, and what makes "a file the app
   could not place" fixable without opening the file. It is `restampText` with one key, so what is
   worth proving is that the loader then PLACES the file. */
describe('assigning a content type', () => {
	const UNNAMED = 'id,name_en\nblinded,Blinded';

	it('writes the directive, and the loader reads the file as that type', async () => {
		const stamped = await restampText(UNNAMED, { type: 'effect', source: 'My Pack' });
		expect(stamped).toContain('#content-type: effect');

		const storage = new MemoryStorage();
		await storage.write('content/mystuff.csv', stamped);
		const graph = await loadContent(storage, ['content']);
		expect(graph.issues.filter((i) => i.level === 'error')).toEqual([]);
		expect(graph.list('effect').map((r) => r.id)).toEqual(['blinded']);
	});

	it('leaves the file unplaced while nothing declares the type', async () => {
		const storage = new MemoryStorage();
		await storage.write('content/mystuff.csv', UNNAMED);
		const graph = await loadContent(storage, ['content']);
		expect(graph.issues.map((i) => i.key)).toContain('contentIssue.unknownFileType');
		expect(graph.rows).toEqual([]);
	});
});

describe('restampText', () => {
	it('makes a drifted file verify again', async () => {
		expect(await fileHashState(STAMPED)).toBe(HASH_STATE.drift);
		expect(await fileHashState(await restampText(STAMPED))).toBe(HASH_STATE.match);
	});

	it('leaves the body byte-for-byte alone', async () => {
		expect(parseContentDirectives(await restampText(STAMPED)).body).toBe(LF_BODY);
	});

	/* A pack diff compares git blob SHAs, so rewriting line endings to fix a header line would report
	   the whole file as changed against a repo where nothing moved. */
	it('preserves LF / no-BOM', async () => {
		const out = await restampText(STAMPED);
		expect(out.charCodeAt(0)).not.toBe(0xfeff);
		expect(out).not.toContain('\r\n');
	});

	it('preserves CRLF + BOM', async () => {
		const out = await restampText(crlfBom('#content-source: Homebrew', '#content-license: Custom'));
		expect(out.charCodeAt(0)).toBe(0xfeff);
		expect(out.split('\n').length).toBe(out.split('\r\n').length);
		expect(await fileHashState(out)).toBe(HASH_STATE.match);
	});

	it('gives a header to a file that has none — the metadata prompt case', async () => {
		const out = await restampText(LF_BODY, { source: 'My Pack', license: 'CC0-1.0' });
		const { directives, body } = parseContentDirectives(out);
		expect(directives.get('source')).toBe('My Pack');
		expect(directives.get('license')).toBe('CC0-1.0');
		expect(body).toBe(LF_BODY);
		expect(await fileHashState(out)).toBe(HASH_STATE.match);
	});

	it('fills the machine keys it can, and only when absent', async () => {
		const out = await restampText(lf('#content-schema: 0', '#content-source: X'), {}, '2026-08-14');
		const d = parseContentDirectives(out).directives;
		expect(d.get('updated_at')).toBe('2026-08-14');
		expect(d.get('id')).toMatch(/^[0-9a-f-]{36}$/);
		// bumping a declared schema without migrating the rows would be a lie the loader believes
		expect(d.get('schema')).toBe('0');
	});

	it('takes the collected value over the declared one, but a blank field erases nothing', async () => {
		const out = await restampText(STAMPED, { source: 'Fork of SRD', license: '' });
		const d = parseContentDirectives(out).directives;
		expect(d.get('source')).toBe('Fork of SRD');
		expect(d.get('license')).toBe('CC-BY-4.0');
	});

	it('bumps the date when the caller says so — the drift case', async () => {
		const d = parseContentDirectives(
			await restampText(STAMPED, { updated_at: '2026-08-14' }),
		).directives;
		expect(d.get('updated_at')).toBe('2026-08-14');
	});
});

describe('restampFiles', () => {
	it('writes each file with its own collected values', async () => {
		const s = new MemoryStorage();
		await s.write('content/a/one.csv', LF_BODY);
		await s.write('content/a/two.csv', LF_BODY);
		const failures = await restampFiles(s, ['content/a/one.csv', 'content/a/two.csv'], {
			'content/a/one.csv': { source: 'One' },
			'content/a/two.csv': { source: 'Two' },
		});
		expect(failures).toEqual([]);
		expect(parseContentDirectives(await s.read('content/a/one.csv')).directives.get('source')).toBe(
			'One',
		);
		expect(parseContentDirectives(await s.read('content/a/two.csv')).directives.get('source')).toBe(
			'Two',
		);
	});

	/* One unreadable file must not leave every other drifted file frozen. */
	it('reports a failure and still stamps the rest', async () => {
		const s = new MemoryStorage();
		await s.write('content/a/ok.csv', LF_BODY);
		const failures = await restampFiles(s, ['content/a/gone.csv', 'content/a/ok.csv']);
		expect(failures.map((f) => f.file)).toEqual(['content/a/gone.csv']);
		expect(failures[0]?.error).toBeTruthy();
		expect(await fileHashState(await s.read('content/a/ok.csv'))).toBe(HASH_STATE.match);
	});
});
