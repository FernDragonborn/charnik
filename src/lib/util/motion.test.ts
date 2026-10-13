import { describe, it, expect } from 'vitest';
import { isMotionReduced, REDUCE_MOTION } from './motion';

describe('reduce motion', () => {
	it('follows the system until the player says otherwise, and then overrules it either way', () => {
		expect(isMotionReduced(REDUCE_MOTION.system, true)).toBe(true);
		expect(isMotionReduced(REDUCE_MOTION.system, false)).toBe(false);
		expect(isMotionReduced(REDUCE_MOTION.on, false)).toBe(true);
		expect(isMotionReduced(REDUCE_MOTION.off, true)).toBe(false);
	});
});
