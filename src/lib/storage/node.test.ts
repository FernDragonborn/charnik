import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeStorage } from './node';

describe('NodeStorage · atomic write', () => {
	it('a write whose rename fails surfaces the error and leaves no temp file behind', async () => {
		// a directory where the file should go refuses the rename on every OS — the portable stand-in
		// for Windows refusing a rename onto a file another process holds open
		const root = mkdtempSync(join(tmpdir(), 'charnik-node-'));
		mkdirSync(join(root, 'held'));
		await expect(new NodeStorage(root).write('held', 'x')).rejects.toThrow();
		expect(readdirSync(root)).toEqual(['held']);
	});
});
