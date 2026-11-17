/** Work nobody awaits says its failure instead of becoming a rejection nobody sees. */
import { describe, expect, it, vi } from 'vitest';
import { sayIfFails, toast } from './toast';

describe('sayIfFails', () => {
	it('says a rejection with what the platform said, and nothing for work that succeeds', async () => {
		const error = vi.spyOn(toast, 'error').mockImplementation(() => {});
		sayIfFails('Could not save', Promise.resolve('fine'));
		sayIfFails('Could not save', Promise.reject(new Error('EBUSY: file is locked')));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(error.mock.calls).toEqual([
			['Could not save', { description: 'EBUSY: file is locked' }],
		]);
		error.mockRestore();
	});
});
