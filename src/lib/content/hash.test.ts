import { describe, it, expect } from 'vitest';
import { hashBody, normalizeBody, HASH_PREFIX } from './hash';

describe('content body hashing', () => {
	it('ignores the directive block, BOM and line endings (Excel re-save is not a change)', async () => {
		const a = 'id,name\nx,X\ny,Y\n';
		const withDirectives = '#content-source: SRD\n#content-hash: xxh64:stale\n' + a;
		const crlfBom = '﻿' + a.replace(/\n/g, '\r\n');
		expect(await hashBody(a)).toBe(await hashBody(withDirectives));
		expect(await hashBody(a)).toBe(await hashBody(crlfBom));
	});

	it('changes when the DATA changes', async () => {
		expect(await hashBody('id,name\nx,X\n')).not.toBe(await hashBody('id,name\nx,Z\n'));
	});

	it('changes when rows are reordered (order is meaningful)', async () => {
		expect(await hashBody('id\na\nb\n')).not.toBe(await hashBody('id\nb\na\n'));
	});

	it('is stable and carries the algo prefix', async () => {
		const h = await hashBody('id\nrow\n');
		expect(h.startsWith(HASH_PREFIX)).toBe(true);
		expect(h).toBe(await hashBody('id\nrow\n')); // deterministic
	});

	it('normalizeBody strips directives + trailing blank lines', () => {
		expect(normalizeBody('#content-type: spell\nid\nx\n\n\n')).toBe('id\nx');
	});
});
