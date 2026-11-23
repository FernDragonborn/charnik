import { defineEnvVars } from '@sveltejs/kit/env';

// `PUBLIC_DEMO` is 'true' in the web demo's build and absent everywhere else, so absence is a value
// (`lib/config/demo.ts` reads it as "not the demo") rather than a missing setting.
export const variables = defineEnvVars({ PUBLIC_DEMO: { public: true, schema: (input) => input } });
