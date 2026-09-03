import base from '../vitest.config';

// Stryker runs the suite once per mutant, so the browser project is excluded here: a Chromium launch
// per mutant costs more than every node test put together, and nothing in the mutated modules is
// reachable only from a component test.
const projects = base.test?.projects ?? [];

export default {
	...base,
	test: {
		...base.test,
		projects: projects.filter((p) => typeof p === 'object' && p.test?.name === 'node'),
	},
};
