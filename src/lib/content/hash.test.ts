import { describe, it, expect } from 'vitest';
import { hashFile, hashInput, fileHashState, stampWithHash, HASH_PREFIX } from './hash';
import { HASH_STATE, type MetaKey } from './meta';

const dir = (entries: [MetaKey, string][]) => new Map<MetaKey, string>(entries);

describe('content file hashing', () => {
	it('ignores BOM and line endings (an Excel re-save is not a change)', async () => {
		const a = '#content-source: SRD\nid,name\nx,X\n';
		const crlfBom = '﻿' + a.replace(/\n/g, '\r\n');
		expect(await hashFile(a)).toBe(await hashFile(crlfBom));
	});

	it('ignores the two stamp lines — they are written BY the stamp, not part of the file', async () => {
		const a = '#content-source: SRD\nid\nx\n';
		const stamped = '#content-hash: xxh64:whatever\n#content-updated_at: 2026-01-01\n' + a;
		const restamped = '#content-hash: xxh64:different\n#content-updated-at: 2030-12-31\n' + a;
		expect(await hashFile(a)).toBe(await hashFile(stamped));
		expect(await hashFile(stamped)).toBe(await hashFile(restamped));
	});

	// the reason the rule changed: `#content-source` is the identity half of `source:id` and decides
	// whether an incoming pack is the same pack, but body-only hashing left it outside the hash
	it('DOES change when a header directive changes — source above all', async () => {
		expect(await hashFile('#content-source: SRD\nid\nx\n')).not.toBe(
			await hashFile('#content-source: Homebrew\nid\nx\n')
		);
	});

	it('changes when the DATA changes, including a reorder (row order is meaningful)', async () => {
		expect(await hashFile('id,name\nx,X\n')).not.toBe(await hashFile('id,name\nx,Z\n'));
		expect(await hashFile('id\na\nb\n')).not.toBe(await hashFile('id\nb\na\n'));
	});

	it('is deterministic and carries the algo prefix', async () => {
		const h = await hashFile('id\nrow\n');
		expect(h.startsWith(HASH_PREFIX)).toBe(true);
		expect(h).toBe(await hashFile('id\nrow\n'));
	});

	it('hashInput drops the stamp lines and trailing blank lines', () => {
		expect(hashInput('#content-hash: xxh64:x\n#content-type: spell\nid\nx\n\n\n')).toBe(
			'#content-type: spell\nid\nx'
		);
	});
});

describe('stamping and verifying agree by construction', () => {
	it('a freshly stamped file verifies as a match', async () => {
		const file = await stampWithHash(
			dir([
				['source', 'SRD'],
				['license', 'CC-BY-4.0']
			]),
			'id\nx'
		);
		expect(await fileHashState(file)).toBe(HASH_STATE.match);
	});

	it('the stamp is the FIRST line, so verifying is "drop the top line"', async () => {
		const file = await stampWithHash(dir([['source', 'SRD']]), 'id\nx');
		expect(file.split('\r\n')[0]).toContain('#content-hash: xxh64:'); // (a BOM may precede it)
	});

	it('an edit to the DATA drifts', async () => {
		const file = await stampWithHash(dir([['source', 'SRD']]), 'id\nx');
		expect(await fileHashState(file.replace('id\r\nx', 'id\r\nEDITED'))).toBe(HASH_STATE.drift);
	});

	it('an edit to the SOURCE drifts too — that is the whole point of the new rule', async () => {
		const file = await stampWithHash(dir([['source', 'SRD']]), 'id\nx');
		expect(await fileHashState(file.replace('SRD', 'Not SRD'))).toBe(HASH_STATE.drift);
	});

	it('a file with no stamp is `unstamped`, never a false "changed"', async () => {
		expect(await fileHashState('id\nx\n')).toBe(HASH_STATE.unstamped);
	});

	// a file stamped by an older build must not read as hand-edited: under the overwrite guard that
	// would freeze it on disk forever, so the pre-header-hashing rule still verifies
	it('a legacy body-only stamp still verifies', async () => {
		// a directive-less file hashes over exactly what the OLD rule hashed: the body alone
		const legacyHash = await hashFile('id\nx');
		expect(await fileHashState(`#content-source: SRD\n#content-hash: ${legacyHash}\nid\nx`)).toBe(
			HASH_STATE.match
		);
	});
});
