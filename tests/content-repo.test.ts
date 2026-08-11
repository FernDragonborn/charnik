import { describe, it, expect, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { contentRepoDir, requireContentRepo } from '../tools/content-repo.mjs';

/*
 * The content lives in a SEPARATE repo (docs/PLAN.md · REL-4 slice 0) and everything that reads it
 * — the build's vendoring step, the SRD converters, the content tests — resolves through this one
 * seam. If its precedence breaks, a build silently vendors the wrong folder, so pin it.
 */
describe('content repo resolver', () => {
	const original = process.env.CHARNIK_CONTENT;
	afterEach(() => {
		if (original === undefined) delete process.env.CHARNIK_CONTENT;
		else process.env.CHARNIK_CONTENT = original;
	});

	it('defaults to the sibling clone, so cloning the two side by side needs no config', () => {
		delete process.env.CHARNIK_CONTENT;
		expect(contentRepoDir()).toBe(resolve(process.cwd(), '../charnik-content-srd'));
	});

	it('CHARNIK_CONTENT overrides it (how CI points at its own checkout)', () => {
		process.env.CHARNIK_CONTENT = '.content-srd';
		expect(contentRepoDir()).toBe(resolve(process.cwd(), '.content-srd'));
	});

	it('a missing clone throws something ACTIONABLE — never a silently empty app', () => {
		process.env.CHARNIK_CONTENT = 'no-such-content-dir';
		expect(() => requireContentRepo()).toThrow(/git clone .*charnik-content-srd/);
	});
});
